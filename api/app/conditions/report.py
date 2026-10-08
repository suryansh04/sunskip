import asyncio
from datetime import datetime, timedelta

from app.conditions.air import get_naqi
from app.conditions.weather import get_hourly_weather
from app.config import IST, settings
from app.contracts.models import Conditions, HourlyConditions, LatLng
from app.core.formulas import round_half_up

HOURS_AHEAD = 24


def as_ist(moment: datetime | None) -> datetime:
    if moment is None:
        return datetime.now(IST)
    if moment.tzinfo is None:
        return moment.replace(tzinfo=IST)
    return moment


def start_of_hour(moment: datetime) -> datetime:
    return moment.astimezone(IST).replace(minute=0, second=0, microsecond=0)


async def get_conditions(location: LatLng, at: datetime) -> Conditions:
    (weather, typical, stale), (naqi, naqi_category) = await asyncio.gather(
        get_hourly_weather(location.lat, location.lng, at),
        get_naqi(location.lat, location.lng, at),
    )
    first_hour = start_of_hour(at)
    hours = [first_hour + timedelta(hours=offset) for offset in range(HOURS_AHEAD)]
    hourly = [
        HourlyConditions(at=hour, temp_c=round_half_up(weather[hour][0]), feels_like_c=round_half_up(weather[hour][1]))
        for hour in hours
        if hour in weather
    ]
    current = hourly[0] if hourly and hourly[0].at == first_hour else HourlyConditions(at=first_hour)
    return Conditions(
        at=at,
        temp_c=current.temp_c,
        feels_like_c=current.feels_like_c,
        naqi=naqi,
        naqi_category=naqi_category,
        heat_alert=current.feels_like_c is not None and current.feels_like_c >= settings.heat_alert_feels_like_c,
        hourly=hourly,
        stale=stale,
        typical=typical,
    )


def feels_like_by_hour(conditions: Conditions) -> dict[datetime, float | None]:
    return {hour.at: hour.feels_like_c for hour in conditions.hourly}
