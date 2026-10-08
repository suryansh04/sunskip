from datetime import date
from typing import Literal

from fastapi import APIRouter, Query

from app.config import settings
from app.contracts.models import SimulateRequest
from app.core.errors import ApiError
from app.core.formulas import round_half_up, round_whole
from app.portal.recommendations import recommend
from app.portal.reports import heat_pain, parse_hours, stretch_evidence, usage_stats
from app.portal.simulate import minutes_saved_per_day, simulate
from app.shade.bbox import parse_bbox
from app.shade.queue import ensure_shade

DEFAULT_MONTH = 5  # May midday is the worst case
DEFAULT_HOURS = "10-16"
DEFAULT_PAIN_LIMIT = 50
MAX_PAIN_LIMIT = 200

router = APIRouter(tags=["portal"])


@router.get("/portal/stats")
async def get_portal_stats(from_: date | None = Query(default=None, alias="from"), to: date | None = None) -> dict:
    return await usage_stats(from_, to)


@router.get("/portal/heat-pain")
async def get_heat_pain(
    bbox: str,
    month: int = Query(default=DEFAULT_MONTH, ge=1, le=12),
    hours: str = DEFAULT_HOURS,
    limit: int = Query(default=DEFAULT_PAIN_LIMIT, ge=1, le=MAX_PAIN_LIMIT),
) -> dict:
    return await heat_pain(parse_bbox(bbox, settings.max_portal_bbox_km2), month, parse_hours(hours), limit)


@router.get("/portal/recommendations")
async def get_recommendations(
    bbox: str,
    type: Literal["TREE", "SHELTER"] = "TREE",
    budget_inr: int | None = Query(default=None, alias="budgetInr", gt=0),
    month: int = Query(default=DEFAULT_MONTH, ge=1, le=12),
    hours: str = DEFAULT_HOURS,
) -> dict:
    box = parse_bbox(bbox, settings.max_portal_bbox_km2)
    return await recommend(box, type, budget_inr, month, parse_hours(hours))


@router.post("/portal/simulate")
async def simulate_items(body: SimulateRequest) -> dict:
    points = [[item.location.lng, item.location.lat] for item in body.items]
    shade = await ensure_shade(
        {"type": "MultiPoint", "coordinates": points}, settings.simulation_reach_m, "PORTAL", None
    )
    simulation = await simulate(body.month, body.hours, body.items)
    if simulation is None:
        if shade.status == "PREPARING":
            raise ApiError(409, "SHADE_PREPARING", "Preparing shade data for this area", {"jobId": shade.job_id})
        raise ApiError(422, "NO_SHADE_DATA", "No paths with shade data near these items")
    return {
        "byHour": [
            {
                "hour": hour["hour"],
                "shadePctBefore": round_whole(hour["before"]),
                "shadePctAfter": round_whole(hour["after"]),
            }
            for hour in simulation.by_hour
        ],
        "segments": [
            {
                "id": f"seg_{segment.segment_id}",
                "sunFractionBefore": round_half_up(segment.sun_before, 2),
                "sunFractionAfter": round_half_up(segment.sun_after, 2),
            }
            for segment in simulation.segments
            if segment.sun_before is not None and segment.sun_after != segment.sun_before
        ],
        "sunMinutesSavedPerDay": round_whole(minutes_saved_per_day(simulation.segments)),
        "approximation": True,
    }


@router.get("/portal/stretches/{stretch_id}")
async def get_stretch(stretch_id: str) -> dict:
    return await stretch_evidence(stretch_id)
