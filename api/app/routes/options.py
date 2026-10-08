from datetime import datetime, timedelta

from app.conditions.report import start_of_hour
from app.config import IST, settings
from app.contracts.models import Leg, RouteOption, Shade
from app.core.formulas import round_whole
from app.db.walk_queries import find_stop_shade
from app.routes.exposure import (
    WalkSun,
    line_nodata_m,
    line_sun,
    load_line_shade,
    peak_feels_like,
    to_exposure,
    unknown_walk_sun,
    wait_sun_minutes,
    walk_sun,
)
from app.routes.walk import WalkPath, find_shadiest_path

TRANSIT_MODES = {"BUS", "METRO", "RAIL"}


def total_sun(walk: WalkSun) -> float:
    return sum(walk.sun_by_hour.values())


def follow_path(leg: Leg, path: WalkPath) -> None:
    """Swaps Google's walking line for our shadier path."""
    leg.polyline = {"type": "LineString", "coordinates": [list(point) for point in path.coords]}
    leg.distance_meters = round_whole(path.length_m)
    leg.duration_seconds = round(path.length_m / settings.walk_speed_mps)
    leg.end_at = leg.start_at + timedelta(seconds=leg.duration_seconds)


def set_coverage(leg: Leg, nodata_m: float) -> None:
    leg.shade_known, leg.coverage = True, "PARTIAL" if nodata_m > 0 else "FULL"


async def score_walk_leg(leg: Leg, feels_like: dict, shade_ready: bool, prefer_cooler: bool) -> tuple[WalkSun, bool]:
    """Scores Google's walking line straight from the shade files (like the pilot walk). Returns the walk's sun,
    and whether our own OSM path is shady enough to be worth offering as a cooler option."""
    coords = [tuple(point) for point in leg.polyline["coordinates"]]
    if not shade_ready or len(coords) < 2:
        leg.shade_known, leg.coverage = False, "NONE"
        return unknown_walk_sun(leg.distance_meters, peak_feels_like(feels_like, leg.start_at, leg.end_at)), False
    month = leg.start_at.astimezone(IST).month
    line = await load_line_shade(coords, month, settings.shade_sample_spacing_m)
    path = await find_shadiest_path(coords, leg.start_at, feels_like)
    line_walk = line_sun(line, leg.start_at, feels_like) if line else None
    path_walk = walk_sun(path, leg.start_at, feels_like) if path else None
    leg.segment_ids = path.segment_ids if path else []
    cooler = bool(
        line_walk and path_walk and total_sun(path_walk) <= total_sun(line_walk) - settings.cooler_path_min_saving_min
    )
    if path_walk and (line_walk is None or (prefer_cooler and cooler)):
        follow_path(leg, path)
        set_coverage(leg, path.nodata_m)
        walk = path_walk
    elif line_walk:
        set_coverage(leg, line_nodata_m(line, leg.start_at))
        walk = line_walk
    else:
        leg.shade_known, leg.coverage = False, "NONE"
        walk = unknown_walk_sun(leg.distance_meters, peak_feels_like(feels_like, leg.start_at, leg.end_at))
    leg.exposure = to_exposure([walk], None, feels_like)
    return walk, cooler


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
    legs: list[Leg],
    fare_inr: int | None,
    depart_at: datetime,
    feels_like: dict,
    shade: Shade,
    prefer_cooler: bool = False,
) -> tuple[RouteOption, bool]:
    """Scores every leg. Returns the option and whether a cooler version (our own paths) is worth offering."""
    walks, waits, has_cooler = [], [], False
    for leg in legs:
        if leg.mode == "WALK":
            walk, cooler = await score_walk_leg(leg, feels_like, shade.status == "READY", prefer_cooler)
            walks.append(walk)
            has_cooler = has_cooler or cooler
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
    return option, has_cooler and not prefer_cooler
