from datetime import date, datetime, timedelta

import httpx

from app.config import IST
from app.core.errors import ApiError
from app.core.http import http_client, track_service
from app.db.cache_queries import conditions_cell_id, read_conditions_cache, write_conditions_cache

FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
HOURLY_FIELDS = "temperature_2m,apparent_temperature"
FORECAST_PAST_DAYS = 2
FORECAST_AHEAD_DAYS = 7
FORECAST_DAYS = 9  # today + 8, so a trip on day +7 still has 24 hours ahead
FORECAST_TTL_MIN = 15
ARCHIVE_TTL_MIN = 30 * 24 * 60
ONE_YEAR_SAME_WEEKDAY = timedelta(days=364)
SOURCES = {  # cache kind -> (url, source name, cache minutes)
    "WEATHER": (FORECAST_URL, "open-meteo", FORECAST_TTL_MIN),
    "WEATHER_ARCHIVE": (ARCHIVE_URL, "open-meteo-archive", ARCHIVE_TTL_MIN),
}

HourlyWeather = dict[datetime, tuple[float | None, float | None]]  # hour start (IST) -> (temp, feels-like)


async def _fetch_hourly(url: str, params: dict) -> dict:
    async with track_service("open_meteo"):
        response = await http_client.get(url, params=params)
        response.raise_for_status()
    return response.json()["hourly"]


async def _cached_hourly(cell_id: str, kind: str, params: dict) -> tuple[dict, bool]:
    url, source, ttl_minutes = SOURCES[kind]
    cached = await read_conditions_cache(cell_id, kind, allow_expired=False)
    if cached:
        return cached, False
    try:
        hourly = await _fetch_hourly(url, params)
    except httpx.HTTPError as error:
        stale = await read_conditions_cache(cell_id, kind, allow_expired=True)
        if stale:
            return stale, True
        raise ApiError(502, "UPSTREAM_ERROR", "The weather service is not answering") from error
    await write_conditions_cache(cell_id, kind, hourly, source, ttl_minutes)
    return hourly, False


def _to_hour_map(hourly: dict, shift: timedelta) -> HourlyWeather:
    return {
        datetime.fromisoformat(time).replace(tzinfo=IST) + shift: (temp, feels)
        for time, temp, feels in zip(
            hourly["time"], hourly["temperature_2m"], hourly["apparent_temperature"], strict=True
        )
    }


async def _archive_day(lat: float, lng: float, day: date, shift: timedelta) -> tuple[HourlyWeather, bool]:
    params = {
        "latitude": lat,
        "longitude": lng,
        "hourly": HOURLY_FIELDS,
        "timezone": "Asia/Kolkata",
        "start_date": day.isoformat(),
        "end_date": (day + timedelta(days=1)).isoformat(),
    }
    cell_id = f"{conditions_cell_id(lat, lng)}@{day.isoformat()}"
    hourly, stale = await _cached_hourly(cell_id, "WEATHER_ARCHIVE", params)
    return _to_hour_map(hourly, shift), stale


async def get_hourly_weather(lat: float, lng: float, at: datetime) -> tuple[HourlyWeather, bool, bool]:
    """Returns (hour -> (temp, feels-like), typical, stale) around `at`."""
    day, today = at.astimezone(IST).date(), datetime.now(IST).date()
    if day > today + timedelta(days=FORECAST_AHEAD_DAYS):
        # Too far ahead to forecast: use the same weekday one year earlier, marked typical
        weather, stale = await _archive_day(lat, lng, day - ONE_YEAR_SAME_WEEKDAY, ONE_YEAR_SAME_WEEKDAY)
        return weather, True, stale
    if day < today - timedelta(days=FORECAST_PAST_DAYS):
        weather, stale = await _archive_day(lat, lng, day, timedelta(0))
        return weather, False, stale
    params = {
        "latitude": lat,
        "longitude": lng,
        "hourly": HOURLY_FIELDS,
        "timezone": "Asia/Kolkata",
        "past_days": FORECAST_PAST_DAYS,
        "forecast_days": FORECAST_DAYS,
    }
    hourly, stale = await _cached_hourly(conditions_cell_id(lat, lng), "WEATHER", params)
    return _to_hour_map(hourly, timedelta(0)), False, stale
