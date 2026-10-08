from fastapi import APIRouter, Response

from app.config import settings
from app.db.status_queries import get_imagery_dates, get_solar_calls_this_month

LANGUAGES = ["en-IN", "hi-IN"]
MODES = ["WALK", "BUS", "METRO", "RAIL", "ERICKSHAW"]
META_CACHE_SECONDS = 3600

router = APIRouter(tags=["meta"])


@router.get("/meta")
async def get_meta(response: Response) -> dict:
    imagery = await get_imagery_dates()
    calls = await get_solar_calls_this_month()
    response.headers["Cache-Control"] = f"public, max-age={META_CACHE_SECONDS}"
    return {
        "shadeModel": "ON_DEMAND",
        "region": "IN",
        "shadeImageryDates": {
            "min": imagery["min_date"].isoformat() if imagery["min_date"] else None,
            "max": imagery["max_date"].isoformat() if imagery["max_date"] else None,
        },
        "shadeBudget": {"state": "EXHAUSTED" if calls >= settings.solar_monthly_call_budget else "OK"},
        "representativeDay": settings.representative_day,
        "languages": LANGUAGES,
        "modes": MODES,
        "heatAlertFeelsLikeC": settings.heat_alert_feels_like_c,
    }
