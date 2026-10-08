from datetime import datetime

from fastapi import APIRouter, Query

from app.conditions.report import as_ist, get_conditions
from app.contracts.models import Conditions, LatLng

router = APIRouter(tags=["conditions"])


@router.get("/conditions", response_model=Conditions)
async def get_conditions_endpoint(
    lat: float = Query(ge=-90, le=90),
    lng: float = Query(ge=-180, le=180),
    at: datetime | None = None,
) -> Conditions:
    return await get_conditions(LatLng(lat=lat, lng=lng), as_ist(at))
