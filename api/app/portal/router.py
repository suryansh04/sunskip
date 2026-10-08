from fastapi import APIRouter

from app.core.errors import not_implemented

router = APIRouter(tags=["portal"])


@router.get("/portal/stats")
async def get_portal_stats():
    raise not_implemented()


@router.get("/portal/heat-pain")
async def get_heat_pain():
    raise not_implemented()


@router.get("/portal/recommendations")
async def get_recommendations():
    raise not_implemented()


@router.post("/portal/simulate")
async def simulate_items():
    raise not_implemented()


@router.get("/portal/stretches/{stretch_id}")
async def get_stretch():
    raise not_implemented()
