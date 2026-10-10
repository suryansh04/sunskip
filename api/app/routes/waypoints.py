from datetime import datetime, timedelta
from uuid import UUID

import numpy as np

from app.conditions.report import start_of_hour
from app.config import IST, settings
from app.contracts.models import LatLng, Leg, RouteOption, Waypoint, WaypointsResponse
from app.core.errors import ApiError
from app.core.geo import FULL_TURN_DEG, bearing_deg, haversine_m, line_length_m, sample_line
from app.db.trip_queries import load_trip
from app.db.walk_queries import load_segments
from app.shade.tiles import NO_DATA, SUN, sun_bits

COMPASS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"]
TURN_DEG = 30
END_GAP_M = 1.0  # a leg's end closer than this to the last sample adds no point (its bearing would be noise)
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


def in_sun_at(bits: np.ndarray, index: int, walked_m: float, start_at: datetime) -> bool | None:
    walked_s = walked_m / settings.walk_speed_mps
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


def leg_points(coords: list[tuple[float, float]]) -> tuple[list[tuple[float, float]], list[float]]:
    """A point every few metres along the leg, always ending at its last point, and how far along each one is."""
    points = sample_line(coords, settings.waypoint_spacing_m)
    along_m = [index * settings.waypoint_spacing_m for index in range(len(points))]
    if haversine_m(points[-1], coords[-1]) >= END_GAP_M:
        points.append(coords[-1])
        along_m.append(line_length_m(coords))
    return points, along_m


async def leg_waypoints(
    leg: Leg, leg_index: int, first_index: int, start_m: float, start_at: datetime
) -> list[Waypoint]:
    points, along_m = leg_points([tuple(point) for point in leg.polyline["coordinates"]])
    bits = await sun_bits(points, start_at.astimezone(IST).month)
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
                distance_from_start_m=round(start_m + along_m[index], 1),
                leg_index=leg_index,
                bearing_deg=round(bearing) % FULL_TURN_DEG,  # 359.6 rounds to 0, not 360
                in_sun=in_sun_at(bits, index, along_m[index], start_at),
                cue=cue,
            )
        )
        previous = bearing
    return waypoints


async def trip_waypoints(trip_id: UUID, option_id: str, at: datetime | None) -> WaypointsResponse:
    """`at` moves the whole trip to another start time, so the sun on each point is shown for that time."""
    option = await load_option(trip_id, option_id)
    shift = at - option.depart_at if at else timedelta(0)
    waypoints, walked_m = [], 0.0
    for leg_index, leg in enumerate(option.legs):
        coords = leg.polyline["coordinates"]
        if leg.mode != "WALK" or len(coords) < 2:
            continue
        waypoints += await leg_waypoints(leg, leg_index, len(waypoints), walked_m, leg.start_at + shift)
        # Measured along the line, so distanceFromStartM runs on across walk legs without gaps
        walked_m += line_length_m([tuple(point) for point in coords])
    return WaypointsResponse(spacing_m=settings.waypoint_spacing_m, waypoints=waypoints)
