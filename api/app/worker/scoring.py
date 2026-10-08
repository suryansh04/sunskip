import asyncio
from collections import defaultdict
from datetime import datetime

from app.config import IST, settings
from app.core.geo import Point, offset_point, sample_line
from app.core.sun import sun_elevations
from app.db.score_queries import load_stops_in_cells, load_unready_segments, save_segment_shade, save_stop_shade
from app.db.shade_queries import get_cell_statuses
from app.shade.queue import DONE
from app.shade.tiles import HOURS, NO_DATA, SUN, cell_of, group_by_cell, month_bits

MONTHS = range(1, 13)
STOP_GRID_STEP_M = 2.5  # 3 x 3 points around a stop, so roughly "within 5 m"


def sunny_hours(point: Point) -> dict[int, list[int]]:
    """Month -> IST hours when the sun is high enough to cast shade worth scoring."""
    year = datetime.now(IST).year
    moments = [
        datetime(year, month, settings.representative_day, hour, tzinfo=IST)
        for month in MONTHS
        for hour in range(HOURS)
    ]
    elevations = sun_elevations(point[1], point[0], moments)
    hours = defaultdict(list)
    for moment, elevation in zip(moments, elevations, strict=True):
        if elevation >= settings.min_sun_elevation_deg:
            hours[moment.month].append(moment.hour)
    return hours


def stop_grid(point: Point) -> list[Point]:
    steps = (-STOP_GRID_STEP_M, 0, STOP_GRID_STEP_M)
    return [offset_point(point, east, north) for east in steps for north in steps]


def build_rows(owners: list[tuple[int, list[Point]]], statuses: dict, hours: dict) -> list[tuple]:
    """Rows of (owner id, month, hour, sun_fraction, nodata_fraction); an owner is a segment or stop with its points."""
    points = [point for _, owner_points in owners for point in owner_points]
    cells_of_points = group_by_cell(points)
    rows = []
    for month in MONTHS:
        bits = month_bits(points, cells_of_points, statuses, month)
        start = 0
        for owner_id, owner_points in owners:
            owner_bits = bits[start : start + len(owner_points)]
            start += len(owner_points)
            for hour in hours[month]:
                column = owner_bits[:, hour]
                with_data = int((column != NO_DATA).sum())
                sun_fraction = float((column == SUN).sum()) / with_data if with_data else 0.0
                rows.append((owner_id, month, hour, sun_fraction, 1 - with_data / len(column)))
    return rows


async def score_cells(cells: list[str]) -> None:
    segments = [
        (segment_id, sample_line(coords, settings.shade_sample_spacing_m))
        for segment_id, coords in await load_unready_segments(cells)
    ]
    stops = [(stop_id, stop_grid(point)) for stop_id, point in await load_stops_in_cells(cells)]
    all_points = [point for _, points in segments + stops for point in points]
    if not all_points:
        return
    statuses = await get_cell_statuses(list({cell_of(point) for point in all_points}))
    # A segment is ready only when every sample point sits in a cell we've finished
    ready = [
        (segment_id, points)
        for segment_id, points in segments
        if all(statuses.get(cell_of(point)) in DONE for point in points)
    ]
    hours = sunny_hours(all_points[0])
    segment_rows = await asyncio.to_thread(build_rows, ready, statuses, hours)
    stop_rows = await asyncio.to_thread(build_rows, stops, statuses, hours)
    if ready:
        await save_segment_shade([segment_id for segment_id, _ in ready], segment_rows)
    if stops:
        # Stops keep only hours where at least one pixel had data
        await save_stop_shade([stop_id for stop_id, _ in stops], [row[:4] for row in stop_rows if row[4] < 1])
