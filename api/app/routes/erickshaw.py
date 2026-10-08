import math
from datetime import datetime, timedelta

import asyncpg

from app.config import settings
from app.contracts.models import Leg, RouteOption, Shade
from app.db.walk_queries import find_erickshaw_zone
from app.routes.options import build_option

METERS_PER_KM = 1000


def worth_swapping(leg: Leg) -> bool:
    hot_minutes = leg.exposure.sun_minutes_hot if leg.exposure else None
    return leg.distance_meters > settings.swap_min_walk_m or (hot_minutes or 0) > settings.swap_min_hot_sun_min


def erickshaw_leg(walk: Leg, zone: asyncpg.Record) -> Leg:
    duration = round(walk.distance_meters / settings.erickshaw_speed_mps + settings.erickshaw_wait_seconds)
    fare = zone["base_fare_inr"] + zone["per_km_inr"] * math.ceil(walk.distance_meters / METERS_PER_KM)
    return Leg(
        mode="ERICKSHAW",
        from_=walk.from_,
        to=walk.to,
        start_at=walk.start_at,
        end_at=walk.start_at + timedelta(seconds=duration),
        distance_meters=walk.distance_meters,
        duration_seconds=duration,
        polyline=walk.polyline,
        fare_inr=fare,
        swapped_from="WALK",
    )


async def erickshaw_option(
    option: RouteOption, depart_at: datetime, feels_like: dict, shade: Shade
) -> RouteOption | None:
    """A copy of the option with its long or hot walks done by e-rickshaw, where both ends are in one zone."""
    legs = [leg.model_copy(deep=True) for leg in option.legs]
    swapped_fares = []
    for index, leg in enumerate(legs):
        if leg.mode != "WALK" or not worth_swapping(leg):
            continue
        location_a, location_b = leg.from_.location, leg.to.location
        zone = await find_erickshaw_zone((location_a.lng, location_a.lat), (location_b.lng, location_b.lat))
        if zone is None:
            continue
        legs[index] = erickshaw_leg(leg, zone)
        swapped_fares.append(legs[index].fare_inr)
    if not swapped_fares:
        return None
    fare = None if option.fare_inr is None else option.fare_inr + sum(swapped_fares)
    swapped, _ = await build_option(legs, fare, depart_at, feels_like, shade)
    swapped.warnings.append("FARE_ESTIMATED")
    return swapped
