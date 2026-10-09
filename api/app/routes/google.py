import hashlib
import json
from datetime import UTC, datetime, timedelta

from app.config import IST, settings
from app.contracts.models import PlaceInput
from app.core.http import http_client, track_service
from app.db.cache_queries import read_routes_cache, write_routes_cache

ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes"
FIELD_MASK = ",".join(
    [
        "routes.duration",
        "routes.distanceMeters",
        "routes.travelAdvisory.transitFare",
        "routes.legs.steps.travelMode",
        "routes.legs.steps.distanceMeters",
        "routes.legs.steps.staticDuration",
        "routes.legs.steps.polyline",
        "routes.legs.steps.startLocation",
        "routes.legs.steps.endLocation",
        "routes.legs.steps.transitDetails",
    ]
)
CACHE_BUCKET_MINUTES = 15
POINT_DECIMALS = 5
ONE_WEEK = timedelta(weeks=1)
BAD_KEY_REASON = "API_KEY_INVALID"  # Google answers a bad key with a 400 too


def google_departure_time(depart_at: datetime) -> datetime:
    """Google can't plan transit in the past, so ask for the same weekday and time in a future week."""
    now = datetime.now(IST)
    if depart_at > now:
        return depart_at
    return depart_at + ((now - depart_at) // ONE_WEEK + 1) * ONE_WEEK


def _waypoint(place: PlaceInput) -> dict:
    if place.query:
        return {"address": place.query}
    return {"location": {"latLng": {"latitude": place.lat, "longitude": place.lng}}}


def _place_key(place: PlaceInput) -> str:
    if place.query:
        return place.query.strip().lower()
    return f"{place.lat:.{POINT_DECIMALS}f},{place.lng:.{POINT_DECIMALS}f}"


def _cache_key(origin: PlaceInput, destination: PlaceInput, mode: str, depart_at: datetime) -> str:
    floored = depart_at.replace(
        minute=depart_at.minute - depart_at.minute % CACHE_BUCKET_MINUTES, second=0, microsecond=0
    )
    key = {
        "origin": _place_key(origin),
        "destination": _place_key(destination),
        "mode": mode,
        "departAt": floored.isoformat(),
    }
    return hashlib.sha256(json.dumps(key, sort_keys=True).encode()).hexdigest()


async def _request_routes(body: dict) -> list[dict]:
    headers = {"X-Goog-Api-Key": settings.google_api_key, "X-Goog-FieldMask": FIELD_MASK}
    async with track_service("google_routes"):
        response = await http_client.post(ROUTES_URL, json=body, headers=headers)
        if response.status_code == 400 and BAD_KEY_REASON not in response.text:
            return []  # place not found or no route: not a Google outage
        response.raise_for_status()
    return response.json().get("routes", [])


async def compute_routes(
    origin: PlaceInput, destination: PlaceInput, depart_at: datetime, travel_mode: str
) -> list[dict]:
    cache_key = _cache_key(origin, destination, travel_mode, depart_at)
    cached = await read_routes_cache(cache_key)
    if cached is not None:
        return cached["routes"]
    body = {
        "origin": _waypoint(origin),
        "destination": _waypoint(destination),
        "travelMode": travel_mode,
        "languageCode": "en",
        "regionCode": "IN",
        "polylineEncoding": "GEO_JSON_LINESTRING",
    }
    if travel_mode == "TRANSIT":
        body["computeAlternativeRoutes"] = True
        body["departureTime"] = depart_at.astimezone(UTC).isoformat().replace("+00:00", "Z")
    routes = await _request_routes(body)
    if routes:  # "no route" isn't cached, so a fixed typo or a new bus line shows up straight away
        await write_routes_cache(cache_key, {"routes": routes})
    return routes
