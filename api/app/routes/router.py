from uuid import UUID

from fastapi import APIRouter, Request, Response

from app.config import settings
from app.contracts.fakes import fake_best_time, fake_plan
from app.contracts.models import (
    BestTimeRequest,
    BestTimeResponse,
    ChoiceRequest,
    PlanRequest,
    PlanResponse,
    WaypointsResponse,
)
from app.db.trip_queries import save_choice
from app.routes.best_time import find_best_time
from app.routes.plan import plan_trip, stored_option
from app.routes.waypoints import load_option, trip_waypoints

router = APIRouter(tags=["routes"])


@router.post("/routes/plan", response_model=PlanResponse)
async def plan_route(body: PlanRequest, request: Request) -> PlanResponse | dict:
    if settings.use_fakes:
        return fake_plan()
    return await plan_trip(body, request.state.client_hash)


@router.post("/routes/best-time", response_model=BestTimeResponse)
async def best_time(body: BestTimeRequest, request: Request) -> BestTimeResponse | dict:
    if settings.use_fakes:
        return fake_best_time()
    return await find_best_time(body, request.state.client_hash)


@router.get("/routes/{trip_id}/options/{option_id}/waypoints", response_model=WaypointsResponse)
async def get_waypoints(trip_id: UUID, option_id: str, language: str = "en-IN") -> WaypointsResponse:
    # Cues are English for now; P2's voice code translates them (language is accepted for later)
    return await trip_waypoints(trip_id, option_id)


@router.post("/routes/{trip_id}/choice", status_code=204)
async def record_choice(trip_id: UUID, body: ChoiceRequest) -> Response:
    option = await load_option(trip_id, body.option_id)
    await save_choice(trip_id, stored_option(option))
    return Response(status_code=204)
