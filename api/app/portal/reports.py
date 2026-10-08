"""Read-only portal views: usage stats, the heat-pain ranking and one stretch's evidence (api.md 13, 14, 17)."""

from datetime import date, datetime, timedelta

from app.config import IST
from app.contracts.models import Shade
from app.core.errors import ApiError
from app.core.formulas import round_half_up, round_whole
from app.db.portal_queries import load_heat_pain, load_stats, load_stretch, load_stretch_sun, load_top_origins
from app.shade.bbox import BBox, bbox_polygon
from app.shade.queue import ensure_shade

DEFAULT_STATS_DAYS = 30
APP_TRIPS_DAYS = 30
ESTIMATED_BELOW_SHARE = 0.5  # walkers are "estimated" while app trips are under half of the estimate
MONTHS, HOURS = 12, 24
STRETCH_PREFIX = "str_"
COORD_DECIMALS = 6


def stretch_code(stretch_id: int) -> str:
    return f"{STRETCH_PREFIX}{stretch_id:03d}"


def stretch_number(code: str) -> int:
    if not code.startswith(STRETCH_PREFIX) or not code[len(STRETCH_PREFIX) :].isdigit():
        raise ApiError(404, "NOT_FOUND", "Unknown stretch")
    return int(code[len(STRETCH_PREFIX) :])


def origin_entry(row) -> dict:
    # Points were snapped to a ~50 m grid; trim the float noise that leaves (18.523500000000002)
    location = {"lat": round(row["lat"], COORD_DECIMALS), "lng": round(row["lng"], COORD_DECIMALS)}
    return {"location": location, "count": row["count"]}


async def usage_stats(start_day: date | None, end_day: date | None) -> dict:
    end = datetime.combine(end_day + timedelta(days=1), datetime.min.time(), IST) if end_day else datetime.now(IST)
    start = (
        datetime.combine(start_day, datetime.min.time(), IST) if start_day else end - timedelta(days=DEFAULT_STATS_DAYS)
    )
    stats = await load_stats(start, end)
    origins = await load_top_origins(start, end)
    return {
        "requests": stats["requests"],
        "okRequests": stats["ok_requests"],
        "choiceRate": round_half_up(stats["choices"] / stats["ok_requests"], 2) if stats["ok_requests"] else None,
        "avgSunMinutesPerTrip": round_half_up(stats["avg_sun_minutes"]),
        "topOrigins": [origin_entry(row) for row in origins],
    }


def pain_feature(row) -> dict:
    walkers = row["walkers_per_day"]
    return {
        "type": "Feature",
        "properties": {
            "stretchId": stretch_code(row["stretch_id"]),
            "name": row["name"],
            "lengthM": round_whole(row["length_m"]),
            "sunShare": round_half_up(row["sun_share"], 2),
            "walkersPerDay": round_whole(walkers),
            "walkersEstimated": row["app_trips_30d"] / APP_TRIPS_DAYS < ESTIMATED_BELOW_SHARE * walkers,
            "painScore": round_whole(row["pain_score"]),
        },
        "geometry": row["geometry"],
    }


async def ready_pain_rows(box: BBox, month: int, hours: tuple[int, int], limit: int) -> tuple[list, Shade]:
    """Ranked stretches in the area. Queues missing shade; 409 if nothing is ready yet, 422 if there's no data."""
    shade = await ensure_shade(bbox_polygon(box), 0, "PORTAL", None)
    rows = await load_heat_pain(box, month, hours, limit)
    if rows:
        return rows, shade
    if shade.status == "PREPARING":
        raise ApiError(409, "SHADE_PREPARING", "Preparing shade data for this area", {"jobId": shade.job_id})
    if shade.status == "UNAVAILABLE":
        raise ApiError(422, "NO_SHADE_DATA", "Google has no shade data for this area")
    return rows, shade


async def heat_pain(box: BBox, month: int, hours: tuple[int, int], limit: int) -> dict:
    rows, shade = await ready_pain_rows(box, month, hours, limit)
    return {
        "shade": shade.model_dump(mode="json", by_alias=True),
        "type": "FeatureCollection",
        "features": [pain_feature(row) for row in rows],
    }


async def stretch_evidence(code: str) -> dict:
    stretch = await load_stretch(stretch_number(code))
    if stretch is None:
        raise ApiError(404, "NOT_FOUND", "Unknown stretch")
    grid = [[None] * HOURS for _ in range(MONTHS)]  # None = sun below 5°
    for row in await load_stretch_sun(stretch["id"]):
        grid[row["month"] - 1][row["hour"]] = round_half_up(row["sun"], 2)
    return {
        "stretchId": code,
        "name": stretch["name"],
        "lengthM": round_whole(stretch["length_m"]),
        "segmentIds": [f"seg_{segment_id}" for segment_id in stretch["segment_ids"]],
        "sunByMonthHour": grid,
        "walkers": {
            "poiEstimate": round_whole(stretch["poi_walkers"]),
            "appTrips30d": round_whole(stretch["app_trips_30d"]),
            "perDay": round_whole(stretch["walkers_per_day"]),
        },
    }


def parse_hours(hours: str) -> tuple[int, int]:
    try:
        first, last = (int(value) for value in hours.split("-"))
    except ValueError as error:
        raise ApiError(400, "INVALID_REQUEST", "hours must look like 10-16") from error
    if not 0 <= first <= last <= HOURS - 1:
        raise ApiError(400, "INVALID_REQUEST", "hours must be between 0 and 23, first <= last")
    return first, last
