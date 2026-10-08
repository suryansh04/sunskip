from fastapi import APIRouter

from app.core.errors import not_implemented

router = APIRouter(tags=["routes"])


@router.post("/routes/plan")
async def plan_route():
    raise not_implemented()


@router.post("/routes/best-time")
async def find_best_time():
    raise not_implemented()


@router.get("/routes/{trip_id}/options/{option_id}/waypoints")
async def get_waypoints():
    raise not_implemented()


@router.post("/routes/{trip_id}/choice")
async def record_choice():
    raise not_implemented()
