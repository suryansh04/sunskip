from datetime import datetime

from fastapi import APIRouter, Query

from app.conditions.report import as_ist, get_conditions
from app.config import settings
from app.contracts.fakes import fake_conditions
from app.contracts.models import Conditions, LatLng
from app.core.geo import MAX_LAT, MAX_LNG

router = APIRouter(tags=["conditions"])


@router.get("/conditions", response_model=Conditions)
async def get_conditions_endpoint(
    lat: float = Query(ge=-MAX_LAT, le=MAX_LAT),
    lng: float = Query(ge=-MAX_LNG, le=MAX_LNG),
    at: datetime | None = None,
) -> Conditions | dict:
    if settings.use_fakes:
        return fake_conditions()
    return await get_conditions(LatLng(lat=lat, lng=lng), as_ist(at))
