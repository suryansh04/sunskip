from datetime import datetime, timedelta

from app.conditions.report import start_of_hour
from app.config import settings
from app.contracts.models import Leg, RouteOption, Shade
from app.core.formulas import round_half_up
from app.db.walk_queries import find_stop_shade
from app.routes.exposure import WalkSun, peak_feels_like, to_exposure, unknown_walk_sun, wait_sun_minutes, walk_sun
from app.routes.walk import find_shadiest_path

TRANSIT_MODES = {"BUS", "METRO", "RAIL"}


async def score_walk_leg(leg: Leg, feels_like: dict, shade_ready: bool) -> WalkSun:
    """Swaps Google's walk for our shadiest path when shade data is ready, and fills in its exposure."""
    coords = [tuple(point) for point in leg.polyline["coordinates"]]
    path = await find_shadiest_path(coords, leg.start_at, feels_like) if shade_ready and len(coords) > 1 else None
    if path is None:
        leg.shade_known, leg.coverage = False, "NONE"
        walk = unknown_walk_sun(leg.distance_meters, peak_feels_like(feels_like, leg.start_at, leg.end_at))
    else:
        leg.polyline = {"type": "LineString", "coordinates": [list(point) for point in path.coords]}
        leg.distance_meters = round_half_up(path.length_m, 0)
        leg.duration_seconds = round(path.length_m / settings.walk_speed_mps)
        leg.end_at = leg.start_at + timedelta(seconds=leg.duration_seconds)
        leg.segment_ids = path.segment_ids
        leg.shade_known, leg.coverage = True, "PARTIAL" if path.nodata_m > 0 else "FULL"
        walk = walk_sun(path, leg.start_at, feels_like)
    leg.exposure = to_exposure([walk], None, feels_like)
    return walk


async def score_transit_leg(leg: Leg) -> tuple[float, datetime]:
    """Fills in the wait at the boarding stop and returns (minutes waiting in sun, when)."""
    headway = leg.line.headway_seconds if leg.line else None
    leg.wait_seconds = headway // 2 if headway else settings.default_wait_seconds
    hour = start_of_hour(leg.start_at)
    location = leg.from_.location
    stop = await find_stop_shade(location.lng, location.lat, hour.month, hour.hour, settings.stop_match_m)
    leg.stop_shaded = stop["shaded"] if stop else None
    return wait_sun_minutes(leg.wait_seconds, leg.stop_shaded, stop["sun_fraction"] if stop else None), leg.start_at


def option_warnings(option: RouteOption, shade_status: str) -> list[str]:
    walk_legs = [leg for leg in option.legs if leg.mode == "WALK"]
    exposure = option.exposure
    checks = {
        "HEAT_ALERT": exposure.feels_like_c is not None and exposure.feels_like_c >= settings.heat_alert_feels_like_c,
        "LONG_WAIT_IN_SUN": (exposure.wait_sun_minutes or 0) >= settings.long_wait_in_sun_min,
        "SHADE_PREPARING": shade_status == "PREPARING" and any(not leg.shade_known for leg in walk_legs),
        "NO_SHADE_DATA": shade_status == "UNAVAILABLE",
        "NO_SHADE_DATA_PARTIAL": any(leg.coverage == "PARTIAL" for leg in walk_legs),
    }
    return [warning for warning, applies in checks.items() if applies]


async def build_option(
    legs: list[Leg], fare_inr: int | None, depart_at: datetime, feels_like: dict, shade: Shade
) -> RouteOption:
    walks, waits = [], []
    for leg in legs:
        if leg.mode == "WALK":
            walks.append(await score_walk_leg(leg, feels_like, shade.status == "READY"))
        elif leg.mode in TRANSIT_MODES:
            waits.append(await score_transit_leg(leg))
    arrive_at = legs[-1].end_at
    option = RouteOption(
        option_id="",
        depart_at=depart_at,
        arrive_at=arrive_at,
        duration_seconds=round((arrive_at - depart_at).total_seconds()),
        fare_inr=fare_inr,
        exposure=to_exposure(walks, waits, feels_like),
        legs=legs,
    )
    option.warnings = option_warnings(option, shade.status)
    return option
