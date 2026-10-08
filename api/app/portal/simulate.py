"""What-if shade from virtual trees and shelters (api.md endpoint 16). An approximation: no trunks, canopy gaps or
growth time."""

import math
from dataclasses import dataclass
from datetime import datetime

import numpy as np
import shapely
from shapely import affinity
from shapely.geometry import Point as ShapelyPoint
from shapely.geometry import box

from app.config import IST, settings
from app.contracts.ids import segment_code
from app.contracts.models import SimulatedItem, SimulateRequest
from app.core.errors import ApiError
from app.core.formulas import round_half_up, round_whole
from app.core.geo import Point, sample_line, to_local_m
from app.core.sun import sun_positions
from app.db.portal_queries import load_segments_near
from app.shade.queue import ensure_shade
from app.shade.tiles import NO_DATA, SHADE, SUN, sun_bits

SECONDS_PER_MINUTE = 60
SUN_FRACTION_PLACES = 2


@dataclass
class SegmentResult:
    segment_id: int
    length_m: float
    walkers: float
    sun_before: float | None  # average over the hours, None if no shade data
    sun_after: float | None


@dataclass
class Simulation:
    by_hour: list[dict]
    segments: list[SegmentResult]


def shadow_shape(item: SimulatedItem, elevation: float, azimuth: float, origin: Point) -> shapely.Geometry:
    """The item's shadow on the ground, in metres around `origin`: its crown or roof moved away from the sun."""
    x, y = to_local_m((item.location.lng, item.location.lat), origin)
    reach = item.height_m / math.tan(math.radians(elevation))
    away = math.radians(azimuth + 180)
    dx, dy = reach * math.sin(away), reach * math.cos(away)
    if item.type == "TREE":
        return ShapelyPoint(x + dx, y + dy).buffer(item.crown_radius_m)
    roof = box(-item.length_m / 2, -item.width_m / 2, item.length_m / 2, item.width_m / 2)
    roof = affinity.rotate(roof, 90 - item.bearing_deg, origin=(0, 0))  # bearing is clockwise from north
    return affinity.translate(roof, x + dx, y + dy)


def sun_by_hour(month: int, hours: tuple[int, int], origin: Point) -> list[tuple[int, float, float]]:
    """(hour, elevation, azimuth) for the hours the sun is high enough to matter."""
    year = datetime.now(IST).year
    moments = [
        datetime(year, month, settings.representative_day, hour, tzinfo=IST) for hour in range(hours[0], hours[1] + 1)
    ]
    positions = sun_positions(origin[1], origin[0], moments)
    return [
        (moment.hour, elevation, azimuth)
        for moment, (elevation, azimuth) in zip(moments, positions, strict=True)
        if elevation >= settings.min_sun_elevation_deg
    ]


def shade_pct(column: np.ndarray) -> float | None:
    with_data = column != NO_DATA
    return float(100 * (column[with_data] != SUN).mean()) if with_data.any() else None


def sun_share(bits: np.ndarray) -> float | None:
    """Share of sun over all points and hours that have data."""
    with_data = bits != NO_DATA
    return float((bits[with_data] == SUN).mean()) if with_data.any() else None


async def simulate(month: int, hours: tuple[int, int], items: list[SimulatedItem]) -> Simulation | None:
    """None when no shade-ready path is near the items."""
    item_points = [(item.location.lng, item.location.lat) for item in items]
    rows = await load_segments_near(item_points, settings.simulation_reach_m)
    if not rows:
        return None
    samples = [
        sample_line([tuple(p) for p in row["geometry"]["coordinates"]], settings.shade_sample_spacing_m) for row in rows
    ]
    points = [point for segment_points in samples for point in segment_points]
    before = await sun_bits(points, month)
    after = before.copy()
    origin = item_points[0]
    xs, ys = np.array([to_local_m(point, origin) for point in points]).T
    by_hour, hour_columns = [], []
    for hour, elevation, azimuth in sun_by_hour(month, hours, origin):
        shadow = shapely.union_all([shadow_shape(item, elevation, azimuth, origin) for item in items])
        shaded = shapely.contains_xy(shadow, xs, ys)
        after[shaded & (before[:, hour] == SUN), hour] = SHADE
        hour_columns.append(hour)
        by_hour.append({"hour": hour, "before": shade_pct(before[:, hour]), "after": shade_pct(after[:, hour])})
    segments, start = [], 0
    for row, segment_points in zip(rows, samples, strict=True):
        part = slice(start, start + len(segment_points))
        start += len(segment_points)
        segments.append(
            SegmentResult(
                row["id"],
                row["length_m"],
                row["walkers"],
                sun_share(before[part][:, hour_columns]),
                sun_share(after[part][:, hour_columns]),
            )
        )
    return Simulation(by_hour, segments)


def minutes_saved_per_day(segments: list[SegmentResult]) -> float:
    """Walkers x sun minutes each of them no longer spends on these segments."""
    return sum(
        segment.walkers
        * segment.length_m
        * (segment.sun_before - segment.sun_after)
        / settings.walk_speed_mps
        / SECONDS_PER_MINUTE
        for segment in segments
        if segment.sun_before is not None
    )


def changed_segments(segments: list[SegmentResult]) -> list[dict]:
    return [
        {
            "id": segment_code(segment.segment_id),
            "sunFractionBefore": round_half_up(segment.sun_before, SUN_FRACTION_PLACES),
            "sunFractionAfter": round_half_up(segment.sun_after, SUN_FRACTION_PLACES),
        }
        for segment in segments
        if segment.sun_before is not None and segment.sun_after != segment.sun_before
    ]


async def simulate_report(request: SimulateRequest) -> dict:
    """The endpoint's answer. Queues shade near the items if missing; 409 while it's on the way, 422 if none."""
    points = [[item.location.lng, item.location.lat] for item in request.items]
    shade = await ensure_shade(
        {"type": "MultiPoint", "coordinates": points}, settings.simulation_reach_m, "PORTAL", None
    )
    simulation = await simulate(request.month, request.hours, request.items)
    if simulation is None and shade.status == "PREPARING":
        raise ApiError(409, "SHADE_PREPARING", "Preparing shade data for this area", {"jobId": shade.job_id})
    if simulation is None:
        raise ApiError(422, "NO_SHADE_DATA", "No paths with shade data near these items")
    by_hour = [
        {
            "hour": hour["hour"],
            "shadePctBefore": round_whole(hour["before"]),
            "shadePctAfter": round_whole(hour["after"]),
        }
        for hour in simulation.by_hour
    ]
    return {
        "byHour": by_hour,
        "segments": changed_segments(simulation.segments),
        "sunMinutesSavedPerDay": round_whole(minutes_saved_per_day(simulation.segments)),
        "approximation": True,
    }
