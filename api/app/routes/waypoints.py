from datetime import datetime, timedelta
from uuid import UUID

from app.conditions.report import start_of_hour
from app.config import IST, settings
from app.contracts.models import LatLng, Leg, RouteOption, Waypoint, WaypointsResponse
from app.core.errors import ApiError
from app.core.geo import Point, bearing_deg, sample_line
from app.db.trip_queries import load_trip
from app.routes.walk import NO_SHADE_ROW, WalkPath, load_walk_path

COMPASS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"]
TURN_DEG = 30
IN_SUN_FROM = 0.5


async def load_option(trip_id: UUID, option_id: str) -> RouteOption:
    trip = await load_trip(trip_id)
    if trip is None:
        raise ApiError(404, "NOT_FOUND", "This trip has expired. Plan it again")
    option = next((option for option in trip["options"] if option["optionId"] == option_id), None)
    if option is None:
        raise ApiError(404, "NOT_FOUND", "Unknown option for this trip")
    return RouteOption.model_validate(option)


def compass(bearing: float) -> str:
    return COMPASS[round(bearing / 45) % len(COMPASS)]


def piece_at(path: WalkPath, distance_m: float) -> int:
    walked = 0.0
    for segment_id, length in path.pieces:
        walked += length
        if distance_m <= walked:
            return segment_id
    return path.pieces[-1][0]


def in_sun_at(path: WalkPath | None, distance_m: float, start_at: datetime) -> bool | None:
    if path is None or not path.pieces:
        return None  # shade unknown: AR draws it grey
    hour = start_of_hour(start_at + timedelta(seconds=distance_m / settings.walk_speed_mps))
    sun_fraction, nodata_fraction = path.sun.get((piece_at(path, distance_m), hour.hour), NO_SHADE_ROW)
    return None if nodata_fraction >= 1 else sun_fraction >= IN_SUN_FROM


def turn_cue(bearing: float, previous: float | None) -> str | None:
    if previous is None:
        return None
    turn = (bearing - previous + 540) % 360 - 180  # -180..180, positive = right
    if abs(turn) < TURN_DEG:
        return None
    return "Turn right" if turn > 0 else "Turn left"


def leg_waypoints(leg: Leg, leg_index: int, path: WalkPath | None, first_index: int, start_m: float) -> list[Waypoint]:
    points: list[Point] = sample_line([tuple(p) for p in leg.polyline["coordinates"]], settings.waypoint_spacing_m)
    waypoints, previous = [], None
    for index, point in enumerate(points):
        ahead = points[index + 1] if index + 1 < len(points) else None
        bearing = bearing_deg(point, ahead) if ahead else (previous or 0.0)
        along_m = index * settings.waypoint_spacing_m
        if index == 0:
            name = path.names.get(path.pieces[0][0]) if path and path.pieces else None
            cue = f"Head {compass(bearing)} along {name or 'the path'}"
        else:
            cue = turn_cue(bearing, previous)
        waypoints.append(
            Waypoint(
                index=first_index + index,
                location=LatLng(lat=point[1], lng=point[0]),
                distance_from_start_m=start_m + along_m,
                leg_index=leg_index,
                bearing_deg=round(bearing),
                in_sun=in_sun_at(path, along_m, leg.start_at),
                cue=cue,
            )
        )
        previous = bearing
    return waypoints


async def trip_waypoints(trip_id: UUID, option_id: str) -> WaypointsResponse:
    option = await load_option(trip_id, option_id)
    month = option.depart_at.astimezone(IST).month
    waypoints, walked_m = [], 0.0
    for leg_index, leg in enumerate(option.legs):
        if leg.mode != "WALK" or len(leg.polyline["coordinates"]) < 2:
            continue
        path = await load_walk_path(leg.segment_ids, leg.polyline["coordinates"], month) if leg.segment_ids else None
        waypoints += leg_waypoints(leg, leg_index, path, len(waypoints), walked_m)
        walked_m += leg.distance_meters
    return WaypointsResponse(spacing_m=settings.waypoint_spacing_m, waypoints=waypoints)
