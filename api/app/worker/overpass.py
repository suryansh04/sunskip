import asyncio
import hashlib
import math
from itertools import pairwise

import httpx

from app.config import settings
from app.core.geo import Point, haversine_m, interpolate
from app.core.http import http_client, track_service
from app.db.osm_queries import (
    get_area_bbox,
    mark_area_failed,
    save_pois,
    save_stops,
    save_walk_graph,
    set_area_status,
)
from app.db.shade_queries import get_area_statuses

OVERPASS_TIMEOUT_S = 60  # Overpass is slow; the one call allowed past the usual 10 s
OVERPASS_RETRY_WAIT_S = 30
OVERPASS_TRIES = 3
RETRY_STATUSES = {406, 429, 504}
RUNTIME_ERROR = "runtime error"  # a busy server can answer 200 with partial data and this remark
SPLIT_ID_BYTES = 7

QUERY = """
[out:json][timeout:50];
way["highway"~"^(footway|path|pedestrian|steps|living_street|residential|service|unclassified|track|cycleway|corridor|tertiary|tertiary_link|secondary|secondary_link|primary|primary_link)$"]["access"!~"^(private|no)$"]["foot"!~"^no$"]({bbox});
out geom;
(
  node["highway"="bus_stop"]({bbox});
  node["public_transport"="platform"]({bbox});
  node["railway"="station"]["station"="subway"]({bbox});
);
out;
(
  nwr["amenity"~"^(university|college|school|restaurant|cafe|fast_food)$"]({bbox});
  nwr["building"="dormitory"]({bbox});
  nwr["tourism"="hostel"]({bbox});
  nwr["shop"]({bbox});
  node["barrier"="gate"]["name"]({bbox});
);
out center;
"""

# Walkers per day each kind of place creates. Guesses, shown as estimates in the portal
POI_WEIGHTS = {"HOSTEL": 300, "ACADEMIC": 500, "CAMPUS_GATE": 400, "FOOD": 50, "SHOP": 30, "OTHER": 20}
ACADEMIC_AMENITIES = {"university", "college", "school"}
FOOD_AMENITIES = {"restaurant", "cafe", "fast_food"}


def split_point_id(way_id: int, split_index: int) -> int:
    # Negative ids never clash with real OSM node ids, and the same way always gets the same ids
    digest = hashlib.sha1(f"{way_id}:{split_index}".encode()).digest()
    return -(int.from_bytes(digest[:SPLIT_ID_BYTES], "big") + 1)


def way_to_rows(way: dict) -> tuple[list[tuple], list[tuple]]:
    """Cuts a way at every OSM node, then into equal pieces of at most max_segment_m."""
    nodes = [
        (node_id, (point["lon"], point["lat"])) for node_id, point in zip(way["nodes"], way["geometry"], strict=True)
    ]
    node_rows = [(node_id, *point) for node_id, point in nodes]
    segment_rows, split_index = [], 0
    for (node_a, a), (node_b, b) in pairwise(nodes):
        piece_m = haversine_m(a, b)
        if piece_m == 0:
            continue
        parts = math.ceil(piece_m / settings.max_segment_m)
        points: list[Point] = [interpolate(a, b, part / parts) for part in range(parts + 1)]
        ids = [node_a]
        for point in points[1:-1]:
            split_index += 1
            ids.append(split_point_id(way["id"], split_index))
            node_rows.append((ids[-1], *point))
        ids.append(node_b)
        for start, end, from_id, to_id in zip(points, points[1:], ids, ids[1:], strict=False):
            segment_rows.append(
                (
                    from_id,
                    to_id,
                    way["id"],
                    len(segment_rows),
                    way["tags"]["highway"],
                    way["tags"].get("name"),
                    *start,
                    *end,
                    piece_m / parts,
                )
            )
    return node_rows, segment_rows


def is_stop(tags: dict) -> bool:
    return (
        tags.get("highway") == "bus_stop"
        or tags.get("public_transport") == "platform"
        or tags.get("station") == "subway"
    )


def stop_row(node: dict) -> tuple:
    tags = node["tags"]
    kind = "METRO" if tags.get("station") == "subway" else "BUS"
    name = tags.get("name") or ("Metro station" if kind == "METRO" else "Bus stop")
    return kind, name, node["id"], node["lon"], node["lat"], tags.get("shelter") == "yes"


def poi_kind(tags: dict) -> str:
    amenity = tags.get("amenity")
    if tags.get("building") == "dormitory" or tags.get("tourism") == "hostel":
        return "HOSTEL"
    if amenity in ACADEMIC_AMENITIES:
        return "ACADEMIC"
    if tags.get("barrier") == "gate":
        return "CAMPUS_GATE"
    if amenity in FOOD_AMENITIES:
        return "FOOD"
    if "shop" in tags:
        return "SHOP"
    return "OTHER"


def poi_row(element: dict) -> tuple:
    point = element.get("center") or element
    kind = poi_kind(element["tags"])
    osm_id = f"{element['type']}/{element['id']}"
    return osm_id, kind, element["tags"].get("name"), point["lon"], point["lat"], POI_WEIGHTS[kind]


class OverpassBusyError(Exception):
    pass


def is_busy(error: httpx.HTTPError) -> bool:
    if isinstance(error, httpx.HTTPStatusError):
        return error.response.status_code in RETRY_STATUSES
    return isinstance(error, httpx.TransportError)


async def run_overpass_query(query: str) -> list[dict]:
    """Tries each Overpass server in turn; public servers are often busy, so a full round waits and retries."""
    last_error = None
    for round_number in range(1, OVERPASS_TRIES + 1):
        for url in settings.overpass_urls:
            try:
                async with track_service("overpass"):
                    response = await http_client.post(url, data={"data": query}, timeout=OVERPASS_TIMEOUT_S)
                    response.raise_for_status()
                    answer = response.json()
                    if RUNTIME_ERROR in answer.get("remark", ""):
                        raise OverpassBusyError(answer["remark"])
                return answer["elements"]
            except OverpassBusyError as error:
                last_error = error
            except httpx.HTTPError as error:
                if not is_busy(error):
                    raise
                last_error = error
        if round_number < OVERPASS_TRIES:
            await asyncio.sleep(OVERPASS_RETRY_WAIT_S)
    raise last_error


async def fetch_area_elements(bbox: tuple[float, float, float, float]) -> list[dict]:
    return await run_overpass_query(QUERY.replace("{bbox}", ",".join(str(value) for value in bbox)))


async def save_area_elements(elements: list[dict]) -> None:
    node_rows, segment_rows, stop_rows, poi_rows = [], [], [], []
    for element in elements:
        tags = element.get("tags", {})
        if element["type"] == "way" and "geometry" in element and "highway" in tags:
            nodes, segments = way_to_rows(element)
            node_rows += nodes
            segment_rows += segments
        elif element["type"] == "node" and is_stop(tags):
            stop_rows.append(stop_row(element))
        elif tags:
            poi_rows.append(poi_row(element))
    await save_walk_graph(node_rows, segment_rows)
    await save_stops(stop_rows)
    await save_pois(poi_rows)


async def load_osm_area(geohash6: str) -> None:
    statuses = await get_area_statuses([geohash6])
    if statuses.get(geohash6) == "READY":
        return
    await set_area_status(geohash6, "FETCHING")
    try:
        elements = await fetch_area_elements(await get_area_bbox(geohash6))
        await save_area_elements(elements)
    except Exception as error:
        await mark_area_failed(geohash6, type(error).__name__)
        raise
    await set_area_status(geohash6, "READY")
