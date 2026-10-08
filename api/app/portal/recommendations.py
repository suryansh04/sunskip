"""Where to plant trees or put shelters, ranked by sun minutes saved per rupee (api.md endpoint 15)."""

import calendar
from collections import defaultdict

import asyncpg

from app.config import settings
from app.contracts.ids import stretch_code
from app.contracts.models import MAX_SIMULATED_ITEMS, LatLng, SimulatedItem
from app.core.formulas import round_whole
from app.core.geo import Point, haversine_m, sample_line
from app.db.portal_queries import load_stops_near_stretches, load_stretch_segments
from app.portal.reports import ready_pain_rows
from app.portal.simulate import SegmentResult, minutes_saved_per_day, simulate
from app.shade.bbox import BBox

TOP_STRETCHES = 20
STOP_NEAR_M = 30


def spread_out(points: list[Point], spacing_m: float) -> list[Point]:
    """Keeps points at least spacing_m apart (segment ends repeat between neighbouring segments)."""
    kept = []
    for point in points:
        if all(haversine_m(point, other) >= spacing_m for other in kept):
            kept.append(point)
    return kept


def tree_items(segment_lines: list[list[Point]]) -> list[SimulatedItem]:
    points = [point for line in segment_lines for point in sample_line(line, settings.tree_spacing_m)]
    return [
        SimulatedItem(
            type="TREE",
            location=LatLng(lat=point[1], lng=point[0]),
            height_m=settings.tree_height_m,
            crown_radius_m=settings.tree_crown_radius_m,
        )
        for point in spread_out(points, settings.tree_spacing_m)[:MAX_SIMULATED_ITEMS]
    ]


def shelter_items(stop: Point | None, segment_lines: list[list[Point]]) -> list[SimulatedItem]:
    """One shelter: at the nearest stop, or else halfway along the stretch."""
    middle_line = segment_lines[len(segment_lines) // 2]
    point = stop or middle_line[len(middle_line) // 2]
    return [
        SimulatedItem(
            type="SHELTER",
            location=LatLng(lat=point[1], lng=point[0]),
            height_m=settings.shelter_height_m,
            width_m=settings.shelter_width_m,
            length_m=settings.shelter_length_m,
        )
    ]


def stretch_shade_pct(segments: list[SegmentResult], after: bool) -> int | None:
    known = [segment for segment in segments if segment.sun_before is not None]
    length = sum(segment.length_m for segment in known)
    if not length:
        return None
    sun_m = sum(segment.length_m * (segment.sun_after if after else segment.sun_before) for segment in known)
    return round_whole(100 * (1 - sun_m / length))


def reason(row: asyncpg.Record, month: int, hours: tuple[int, int]) -> str:
    return (
        f"{round_whole(row['length_m'])} m in {round_whole(100 * row['sun_share'])}% sun "
        f"from {hours[0]}:00 to {hours[1]}:00 in {calendar.month_name[month]}, "
        f"used by about {round_whole(row['walkers_per_day'])} people a day."
    )


async def stretch_segments(stretch_ids: list[int]) -> dict[int, dict[int, list[Point]]]:
    """Stretch id -> {segment id: its line}."""
    segments = defaultdict(dict)
    for row in await load_stretch_segments(stretch_ids):
        segments[row["stretch_id"]][row["id"]] = [tuple(point) for point in row["geometry"]["coordinates"]]
    return segments


async def score_stretch(
    row: asyncpg.Record,
    segment_ids: set[int],
    items: list[SimulatedItem],
    month: int,
    hours: tuple[int, int],
    kind: str,
) -> dict | None:
    simulation = await simulate(month, hours, items)
    if simulation is None:
        return None
    on_stretch = [segment for segment in simulation.segments if segment.segment_id in segment_ids]
    saved = minutes_saved_per_day(on_stretch)
    if saved <= 0:
        return None
    unit_cost = settings.tree_cost_inr if kind == "TREE" else settings.shelter_cost_inr
    return {
        "type": kind,
        "stretchId": stretch_code(row["stretch_id"]),
        "count": len(items),
        "positions": [{"lat": item.location.lat, "lng": item.location.lng} for item in items],
        "impact": {
            "shadePctBefore": stretch_shade_pct(on_stretch, after=False),
            "shadePctAfter": stretch_shade_pct(on_stretch, after=True),
            "walkersPerDay": round_whole(row["walkers_per_day"]),
            "sunMinutesSavedPerDay": round_whole(saved),
        },
        "costInr": len(items) * unit_cost,
        "costEstimated": True,
        "reason": reason(row, month, hours),
    }


def within_budget(candidates: list[dict], budget_inr: int | None) -> list[dict]:
    if budget_inr is None:
        return candidates
    chosen, spent = [], 0
    for candidate in candidates:
        if spent + candidate["costInr"] <= budget_inr:
            chosen.append(candidate)
            spent += candidate["costInr"]
    return chosen


async def recommend(box: BBox, kind: str, budget_inr: int | None, month: int, hours: tuple[int, int]) -> dict:
    rows, _ = await ready_pain_rows(box, month, hours, TOP_STRETCHES)
    stretch_ids = [row["stretch_id"] for row in rows]
    segments = await stretch_segments(stretch_ids)
    stops = {}
    if kind == "SHELTER":
        stops = {
            row["stretch_id"]: (row["lng"], row["lat"])
            for row in await load_stops_near_stretches(stretch_ids, STOP_NEAR_M)
        }

    async def score(row: asyncpg.Record) -> dict | None:
        stretch = segments[row["stretch_id"]]
        lines = list(stretch.values())
        items = tree_items(lines) if kind == "TREE" else shelter_items(stops.get(row["stretch_id"]), lines)
        return await score_stretch(row, set(stretch), items, month, hours, kind)

    candidates = [candidate for row in rows if (candidate := await score(row))]
    candidates.sort(
        key=lambda candidate: candidate["impact"]["sunMinutesSavedPerDay"] / candidate["costInr"], reverse=True
    )
    chosen = within_budget(candidates, budget_inr)
    return {"recommendations": [{"rank": rank, **candidate} for rank, candidate in enumerate(chosen, start=1)]}
