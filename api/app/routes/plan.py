import asyncio
import time
import uuid
from datetime import datetime

import httpx

from app.conditions.report import as_ist, feels_like_by_hour, get_conditions
from app.config import settings
from app.contracts.models import Leg, PlanRequest, PlanResponse, RouteOption, Shade, TripConditions
from app.core.errors import ApiError
from app.db.trip_queries import RequestLog, log_route_request, save_trip
from app.routes.erickshaw import erickshaw_option
from app.routes.google import compute_routes, google_departure_time
from app.routes.legs import parse_route, route_fare_inr
from app.routes.options import build_option
from app.routes.ranking import rank_options
from app.shade.queue import ensure_shade

FAILED_STATUSES = {422: "NO_ROUTE_FOUND", 502: "UPSTREAM_ERROR"}
WALK_ONLY_FARE_INR = 0


async def fetch_google_routes(request: PlanRequest, google_time: datetime) -> tuple[list[dict], list[dict]]:
    """(transit routes, walk-only routes). A Google outage only fails the plan if no walk is left."""
    transit, walk = await asyncio.gather(
        compute_routes(request.origin, request.destination, google_time, "TRANSIT"),
        compute_routes(request.origin, request.destination, google_time, "WALK"),
        return_exceptions=True,
    )
    for result in (transit, walk):
        if isinstance(result, Exception) and not isinstance(result, httpx.HTTPError):
            raise result
    walk_routes = [] if isinstance(walk, Exception) else walk
    walk_routes = [route for route in walk_routes if route.get("distanceMeters", 0) <= settings.walk_only_max_m][:1]
    if isinstance(transit, Exception) and not walk_routes:
        raise ApiError(502, "UPSTREAM_ERROR", "The routing service is not answering")
    return ([] if isinstance(transit, Exception) else transit), walk_routes


def unique_routes(routes: list[tuple[list[Leg], int | None]]) -> list[tuple[list[Leg], int | None]]:
    seen, unique = set(), []
    for legs, fare in routes:
        signature = tuple((leg.mode, leg.line.short_name if leg.line else None) for leg in legs)
        if legs and signature not in seen:
            seen.add(signature)
            unique.append((legs, fare))
    return unique


async def trip_conditions(legs: list[Leg], depart_at: datetime) -> tuple[TripConditions, dict]:
    try:
        conditions = await get_conditions(legs[0].from_.location, depart_at)
    except ApiError:
        return TripConditions(), {}  # no weather: heat weights fall back to 1
    trip = TripConditions(
        feels_like_c=conditions.feels_like_c, heat_alert=conditions.heat_alert, typical=conditions.typical
    )
    return trip, feels_like_by_hour(conditions)


async def check_shade(routes: list[tuple[list[Leg], int | None]], client_hash: str) -> Shade:
    walk_lines = [
        leg.polyline["coordinates"]
        for legs, _ in routes
        for leg in legs
        if leg.mode == "WALK" and len(leg.polyline["coordinates"]) > 1
    ]
    if not walk_lines:
        return Shade(status="READY")
    area = {"type": "MultiLineString", "coordinates": walk_lines}
    return await ensure_shade(area, settings.corridor_buffer_m, "PLAN", client_hash)


async def build_plan(request: PlanRequest, depart_at: datetime, client_hash: str) -> PlanResponse:
    google_time = google_departure_time(depart_at)
    transit, walk = await fetch_google_routes(request, google_time)
    shift = depart_at - google_time
    routes = unique_routes(
        [(parse_route(route, depart_at, shift), route_fare_inr(route)) for route in transit]
        + [(parse_route(route, depart_at, shift), WALK_ONLY_FARE_INR) for route in walk]
    )
    if not routes:
        raise ApiError(422, "NO_ROUTE_FOUND", "No route found. Try picking the places on the map")
    conditions, feels_like = await trip_conditions(routes[0][0], depart_at)
    shade = await check_shade(routes, client_hash)
    options = [await build_option(legs, fare, depart_at, feels_like, shade) for legs, fare in routes]
    if request.allow_erickshaw:
        swaps = [await erickshaw_option(option, depart_at, feels_like, shade) for option in options]
        options += [swap for swap in swaps if swap]
    ranked = rank_options(options, request.preference)[: settings.max_options]
    return PlanResponse(trip_id=str(uuid.uuid4()), shade=shade, conditions=conditions, options=ranked)


def stored_option(option: RouteOption) -> dict:
    """The option as the app sees it, plus each leg's segment ids (kept for waypoints and the portal)."""
    data = option.model_dump(mode="json", by_alias=True)
    for leg_data, leg in zip(data["legs"], option.legs, strict=True):
        leg_data["segmentIds"] = leg.segment_ids
    return data


def walk_coverage(option: RouteOption) -> str | None:
    coverages = {leg.coverage for leg in option.legs if leg.mode == "WALK"}
    return next((level for level in ("NONE", "PARTIAL", "FULL") if level in coverages), None)


async def save_plan(plan: PlanResponse, request: PlanRequest, depart_at: datetime, client_hash: str, started: float):
    top = plan.options[0]
    trip_id = uuid.UUID(plan.trip_id)
    await save_trip(
        trip_id,
        client_hash,
        request.model_dump(mode="json", by_alias=True),
        [stored_option(option) for option in plan.options],
    )
    first, last = top.legs[0].from_.location, top.legs[-1].to.location
    await log_route_request(
        RequestLog(
            trip_id=trip_id,
            client_hash=client_hash,
            origin=(first.lng, first.lat),
            destination=(last.lng, last.lat),
            depart_at=depart_at,
            preference=request.preference,
            status="OK",
            coverage=walk_coverage(top),
            shade_status=plan.shade.status,
            shade_job_id=plan.shade.job_id,
            option_count=len(plan.options),
            top_option_id=top.option_id,
            top_sun_minutes=top.exposure.sun_minutes,
            top_segment_ids=tuple(segment_id for leg in top.legs for segment_id in leg.segment_ids),
            latency_ms=round((time.monotonic() - started) * 1000),
        )
    )


async def log_failed_plan(request: PlanRequest, depart_at: datetime, client_hash: str, error: ApiError) -> None:
    if request.origin.lat is None:
        return  # an address we never resolved has no point to log
    destination = (request.destination.lng, request.destination.lat) if request.destination.lat is not None else None
    await log_route_request(
        RequestLog(
            trip_id=uuid.uuid4(),
            client_hash=client_hash,
            origin=(request.origin.lng, request.origin.lat),
            destination=destination,
            depart_at=depart_at,
            preference=request.preference,
            status=FAILED_STATUSES.get(error.status, "INTERNAL_ERROR"),
        )
    )


async def plan_trip(request: PlanRequest, client_hash: str) -> PlanResponse:
    started = time.monotonic()
    depart_at = as_ist(request.depart_at)
    try:
        plan = await build_plan(request, depart_at, client_hash)
    except ApiError as error:
        await log_failed_plan(request, depart_at, client_hash, error)
        raise
    await save_plan(plan, request, depart_at, client_hash, started)
    return plan
