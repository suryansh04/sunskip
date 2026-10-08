from datetime import date
from typing import Literal

from fastapi import APIRouter, Query

from app.config import settings
from app.contracts.models import SimulateRequest
from app.portal.recommendations import recommend
from app.portal.reports import heat_pain, parse_hours, stretch_evidence, usage_stats
from app.portal.simulate import simulate_report
from app.shade.bbox import parse_bbox

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
    return await simulate_report(body)


@router.get("/portal/stretches/{stretch_id}")
async def get_stretch(stretch_id: str) -> dict:
    return await stretch_evidence(stretch_id)
