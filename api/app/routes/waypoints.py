from datetime import datetime, timedelta
from uuid import UUID

import numpy as np

from app.conditions.report import start_of_hour
from app.config import IST, settings
from app.contracts.models import LatLng, Leg, RouteOption, Waypoint, WaypointsResponse
from app.core.errors import ApiError
from app.core.geo import FULL_TURN_DEG, bearing_deg, sample_line
from app.db.trip_queries import load_trip
from app.db.walk_queries import load_segments
from app.shade.tiles import NO_DATA, SUN, sun_bits

COMPASS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"]
TURN_DEG = 30
COMPASS_STEP_DEG = FULL_TURN_DEG / len(COMPASS)


async def load_option(trip_id: UUID, option_id: str) -> RouteOption:
    trip = await load_trip(trip_id)
    if trip is None:
        raise ApiError(404, "NOT_FOUND", "This trip has expired. Plan it again")
    option = next((option for option in trip["options"] if option["optionId"] == option_id), None)
    if option is None:
        raise ApiError(404, "NOT_FOUND", "Unknown option for this trip")
    return RouteOption.model_validate(option)


def compass(bearing: float) -> str:
    return COMPASS[round(bearing / COMPASS_STEP_DEG) % len(COMPASS)]


def in_sun_at(bits: np.ndarray, index: int, start_at: datetime) -> bool | None:
    walked_s = index * settings.waypoint_spacing_m / settings.walk_speed_mps
    bit = bits[index, start_of_hour(start_at + timedelta(seconds=walked_s)).hour]
    return None if bit == NO_DATA else bool(bit == SUN)  # None: shade unknown, AR draws it grey


def turn_cue(bearing: float, previous: float | None) -> str | None:
    if previous is None:
        return None
    half_turn = FULL_TURN_DEG / 2
    turn = (bearing - previous + half_turn) % FULL_TURN_DEG - half_turn  # -180..180, positive = right
    if abs(turn) < TURN_DEG:
        return None
    return "Turn right" if turn > 0 else "Turn left"


async def first_street_name(leg: Leg) -> str | None:
    if not leg.segment_ids:
        return None
    rows = await load_segments(leg.segment_ids[:1])
    return rows[0]["name"] if rows else None


async def leg_waypoints(leg: Leg, leg_index: int, first_index: int, start_m: float) -> list[Waypoint]:
    points = sample_line([tuple(point) for point in leg.polyline["coordinates"]], settings.waypoint_spacing_m)
    bits = await sun_bits(points, leg.start_at.astimezone(IST).month)
    street = await first_street_name(leg)
    waypoints, previous = [], None
    for index, point in enumerate(points):
        ahead = points[index + 1] if index + 1 < len(points) else None
        bearing = bearing_deg(point, ahead) if ahead else (previous or 0.0)
        cue = f"Head {compass(bearing)} along {street or 'the path'}" if index == 0 else turn_cue(bearing, previous)
        waypoints.append(
            Waypoint(
                index=first_index + index,
                location=LatLng(lat=point[1], lng=point[0]),
                distance_from_start_m=start_m + index * settings.waypoint_spacing_m,
                leg_index=leg_index,
                bearing_deg=round(bearing) % FULL_TURN_DEG,  # 359.6 rounds to 0, not 360
                in_sun=in_sun_at(bits, index, leg.start_at),
                cue=cue,
            )
        )
        previous = bearing
    return waypoints


async def trip_waypoints(trip_id: UUID, option_id: str) -> WaypointsResponse:
    option = await load_option(trip_id, option_id)
    waypoints, walked_m = [], 0.0
    for leg_index, leg in enumerate(option.legs):
        if leg.mode != "WALK" or len(leg.polyline["coordinates"]) < 2:
            continue
        waypoints += await leg_waypoints(leg, leg_index, len(waypoints), walked_m)
        walked_m += leg.distance_meters
    return WaypointsResponse(spacing_m=settings.waypoint_spacing_m, waypoints=waypoints)
