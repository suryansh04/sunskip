from datetime import datetime, timedelta

from app.config import IST
from app.contracts.models import LatLng, Leg, Place, TransitLine

# Google vehicle types -> our modes (api.md §6.5 step 4); anything else counts as BUS
VEHICLE_MODES = {
    "BUS": "BUS",
    "SUBWAY": "METRO",
    "METRO_RAIL": "METRO",
    "TRAM": "METRO",
    "MONORAIL": "METRO",
    "RAIL": "RAIL",
    "HEAVY_RAIL": "RAIL",
    "COMMUTER_TRAIN": "RAIL",
    "HIGH_SPEED_TRAIN": "RAIL",
    "LONG_DISTANCE_TRAIN": "RAIL",
}


def duration_seconds(text: str | None) -> int:
    return round(float(text.rstrip("s"))) if text else 0


def lat_lng(location: dict) -> LatLng:
    point = location["latLng"]
    return LatLng(lat=point["latitude"], lng=point["longitude"])


def walk_leg(steps: list[dict], start_at: datetime) -> Leg:
    coords = []
    for step in steps:
        step_coords = step.get("polyline", {}).get("geoJsonLinestring", {}).get("coordinates", [])
        coords += step_coords[1:] if coords and step_coords and step_coords[0] == coords[-1] else step_coords
    duration = sum(duration_seconds(step.get("staticDuration")) for step in steps)
    return Leg(
        mode="WALK",
        from_=Place(location=lat_lng(steps[0]["startLocation"])),
        to=Place(location=lat_lng(steps[-1]["endLocation"])),
        start_at=start_at,
        end_at=start_at + timedelta(seconds=duration),
        distance_meters=sum(step.get("distanceMeters", 0) for step in steps),
        duration_seconds=duration,
        polyline={"type": "LineString", "coordinates": coords},
    )


def transit_leg(step: dict, time_shift: timedelta) -> Leg:
    details = step["transitDetails"]
    stops, line = details["stopDetails"], details.get("transitLine", {})
    mode = VEHICLE_MODES.get(line.get("vehicle", {}).get("type"), "BUS")
    start_at = datetime.fromisoformat(stops["departureTime"]).astimezone(IST) + time_shift
    end_at = datetime.fromisoformat(stops["arrivalTime"]).astimezone(IST) + time_shift
    return Leg(
        mode=mode,
        from_=Place(name=stops["departureStop"].get("name"), location=lat_lng(stops["departureStop"]["location"])),
        to=Place(name=stops["arrivalStop"].get("name"), location=lat_lng(stops["arrivalStop"]["location"])),
        start_at=start_at,
        end_at=end_at,
        distance_meters=step.get("distanceMeters", 0),
        duration_seconds=round((end_at - start_at).total_seconds()),
        polyline=step.get("polyline", {}).get("geoJsonLinestring", {"type": "LineString", "coordinates": []}),
        line=TransitLine(
            short_name=line.get("nameShort"),
            name=line.get("name"),
            vehicle=mode,
            headway_seconds=duration_seconds(details.get("headway")) or None,
        ),
    )


def route_fare_inr(route: dict) -> int | None:
    fare = route.get("travelAdvisory", {}).get("transitFare")
    if not fare or fare.get("currencyCode") != "INR":
        return None
    return int(fare.get("units", 0))


def parse_route(route: dict, depart_at: datetime, time_shift: timedelta) -> list[Leg]:
    """Joins Google's steps into our legs: back-to-back walking steps become one WALK leg."""
    legs, walk_steps, clock = [], [], depart_at
    steps = [step for route_leg in route.get("legs", []) for step in route_leg.get("steps", [])]
    for step in steps:
        if step.get("travelMode") != "TRANSIT":
            walk_steps.append(step)
            continue
        if walk_steps:
            legs.append(walk_leg(walk_steps, clock))
            walk_steps = []
        legs.append(transit_leg(step, time_shift))
        clock = legs[-1].end_at
    if walk_steps:
        legs.append(walk_leg(walk_steps, clock))
    return legs
