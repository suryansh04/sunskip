"""Labels for stretches that have no name in OpenStreetMap, built from the named places and roads around them."""

import asyncpg

from app.config import settings
from app.db.portal_queries import load_stretch_label_parts

FOOT_WAYS = {"footway", "path", "pedestrian", "steps", "corridor", "cycleway", "track"}


def kind_word(highway: str) -> str:
    if highway in FOOT_WAYS:
        return "Footpath"
    return "Lane" if highway == "service" else "Street"


def short_name(name: str | None) -> str | None:
    # "Ryan International School, Padmavati Nirman Nagar, Jaipur - CBSE" -> "Ryan International School"
    return name and name.split(",")[0].strip()


def label_for(parts: asyncpg.Record) -> str | None:
    word = kind_word(parts["highway"])
    by_place = parts["by_place"] and f"{word} by {short_name(parts['by_place'])}"
    off_road = parts["off_road"] and f"{word} off {short_name(parts['off_road'])}"
    # A footpath is easiest to find by the building it passes; a street or lane by the road it leaves
    nearest = [by_place, off_road] if word == "Footpath" else [off_road, by_place]
    near_road = parts["near_road"] and f"{word} near {short_name(parts['near_road'])}"
    near_place = parts["near_place"] and f"{word} near {short_name(parts['near_place'])}"
    return next((label for label in [*nearest, near_road, near_place] if label), None)


async def stretch_labels(stretch_ids: list[int]) -> dict[int, str | None]:
    """A label for each stretch with no OSM name; stretches with a name aren't in the result."""
    if not stretch_ids:
        return {}
    rows = await load_stretch_label_parts(
        stretch_ids, settings.label_place_m, settings.label_join_m, settings.label_road_m, settings.label_area_m
    )
    return {row["id"]: label_for(row) for row in rows}
