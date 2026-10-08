import logging
from datetime import datetime, timedelta

import httpx

from app.config import IST, settings
from app.core.http import http_client, track_service
from app.db.cache_queries import conditions_cell_id, read_conditions_cache, write_conditions_cache

AIR_URL = "https://airquality.googleapis.com/v1/currentConditions:lookup"
NAQI_CODE = "ind_cpcb"
AIR_TTL_MIN = 15
LIVE_WINDOW = timedelta(hours=1)

logger = logging.getLogger(__name__)


async def _fetch_naqi(lat: float, lng: float) -> dict | None:
    body = {
        "location": {"latitude": lat, "longitude": lng},
        "extraComputations": ["LOCAL_AQI"],
        "universalAqi": False,
    }
    async with track_service("google_air"):
        response = await http_client.post(AIR_URL, params={"key": settings.google_api_key}, json=body)
        response.raise_for_status()
    indexes = response.json().get("indexes", [])
    naqi = next((index for index in indexes if index["code"] == NAQI_CODE), None)
    return {"aqi": naqi["aqi"], "category": naqi["category"]} if naqi else None


async def get_naqi(lat: float, lng: float, at: datetime) -> tuple[int | None, str | None]:
    # Google only knows the air right now, so other times get null
    if abs(at - datetime.now(IST)) > LIVE_WINDOW:
        return None, None
    cell_id = conditions_cell_id(lat, lng)
    cached = await read_conditions_cache(cell_id, "AIR", allow_expired=False)
    if cached:
        return cached["aqi"], cached["category"]
    try:
        naqi = await _fetch_naqi(lat, lng)
    except httpx.HTTPError:
        logger.warning("Air quality lookup failed; banner shows no NAQI")
        return None, None
    if not naqi:
        return None, None
    await write_conditions_cache(cell_id, "AIR", naqi, "google-air-quality", AIR_TTL_MIN)
    return naqi["aqi"], naqi["category"]
