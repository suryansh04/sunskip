import re

from app.config import settings
from app.contracts.models import FoundPlace, LatLng, PlacesResponse
from app.core.formulas import round_whole
from app.db.place_queries import find_named_places

# What students call places, as a Postgres pattern on the OSM names ("G3 block", "B1 Block")
NICKNAMES = {
    "ghs": r"^G\s?\d+\M",
    "girls hostel": r"^G\s?\d+\M",
    "bhs": r"^B\s?\d+\M",
    "boys hostel": r"^B\s?\d+\M",
}


def name_patterns(query: str) -> list[str]:
    typed = " ".join(query.lower().split())
    nicknames = [pattern for nickname, pattern in NICKNAMES.items() if nickname.startswith(typed)]
    return [re.escape(typed), *nicknames]


async def search_places(query: str, lat: float, lng: float) -> PlacesResponse:
    rows = await find_named_places(name_patterns(query), lat, lng, settings.places_radius_m, settings.places_limit)
    places = [
        FoundPlace(
            name=row["name"],
            kind=row["kind"],
            location=LatLng(lat=row["lat"], lng=row["lng"]),
            distance_m=round_whole(row["distance_m"]),
        )
        for row in rows
    ]
    return PlacesResponse(places=places)
