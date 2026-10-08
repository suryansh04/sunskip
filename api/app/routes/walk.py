import asyncio
from dataclasses import dataclass, field
from datetime import datetime
from itertools import pairwise

import networkx as nx

from app.config import IST, settings
from app.core.formulas import heat_weight
from app.core.geo import Point, haversine_m
from app.db.walk_queries import load_corridor_segments, load_segment_shade, load_segments

SunLookup = dict[tuple[int, int], tuple[float, float]]  # (segment id, IST hour) -> (sun_fraction, nodata_fraction)
NO_SHADE_ROW = (0.0, 0.0)  # no row means the sun is below 5°, so no sun on the path


@dataclass
class WalkPath:
    segment_ids: list[int]
    coords: list[Point]
    pieces: list[tuple[int, float]]  # (segment id, length m) in walking order
    length_m: float
    nodata_m: float
    sun: SunLookup
    names: dict[int, str | None] = field(default_factory=dict)


@dataclass
class Corridor:
    ends: dict[int, tuple[int, int]]  # segment id -> (from node, to node)
    lengths: dict[int, float]
    coords: dict[int, list[Point]]
    sun: SunLookup


async def load_corridor(line: dict, month: int) -> Corridor:
    corridor = Corridor(ends={}, lengths={}, coords={}, sun={})
    for row in await load_corridor_segments(line, settings.corridor_buffer_m, month):
        corridor.ends[row["id"]] = (row["from_node"], row["to_node"])
        corridor.lengths[row["id"]] = row["length_m"]
        corridor.coords[row["id"]] = [tuple(point) for point in row["geometry"]["coordinates"]]
        if row["hour"] is not None:
            corridor.sun[(row["id"], row["hour"])] = (row["sun_fraction"], row["nodata_fraction"])
    return corridor


def edge_cost(length_m: float, sun_fraction: float, weight: float) -> float:
    return length_m * (1 + settings.shade_alpha * sun_fraction * weight)


def build_graph(corridor: Corridor, hour: int, weight: float) -> nx.Graph:
    graph = nx.Graph()
    for segment_id, (node_a, node_b) in corridor.ends.items():
        length = corridor.lengths[segment_id]
        if graph.has_edge(node_a, node_b) and graph[node_a][node_b]["length"] <= length:
            continue
        sun_fraction = corridor.sun.get((segment_id, hour), NO_SHADE_ROW)[0]
        graph.add_edge(
            node_a, node_b, segment_id=segment_id, length=length, cost=edge_cost(length, sun_fraction, weight)
        )
    return graph


def nearest_node(corridor: Corridor, point: Point) -> int | None:
    positions = {}
    for segment_id, (node_a, node_b) in corridor.ends.items():
        positions[node_a], positions[node_b] = corridor.coords[segment_id][0], corridor.coords[segment_id][-1]
    best = min(positions, key=lambda node: haversine_m(positions[node], point), default=None)
    if best is None or haversine_m(positions[best], point) > settings.graph_snap_max_m:
        return None
    return best


def choose_nodes(graph: nx.Graph, start: int, end: int) -> list[int] | None:
    try:
        shortest = nx.shortest_path(graph, start, end, weight="length")
        shadiest = nx.shortest_path(graph, start, end, weight="cost")
    except (nx.NetworkXNoPath, nx.NodeNotFound):
        return None
    shortest_m = nx.path_weight(graph, shortest, weight="length")
    shadiest_m = nx.path_weight(graph, shadiest, weight="length")
    # Take the shady path only if the detour is small enough
    return shadiest if shadiest_m <= settings.max_detour_ratio * shortest_m else shortest


def to_walk_path(nodes: list[int], graph: nx.Graph, corridor: Corridor, hour: int) -> WalkPath:
    segment_ids, coords, pieces = [], [], []
    for node_a, node_b in pairwise(nodes):
        segment_id = graph[node_a][node_b]["segment_id"]
        segment_coords = corridor.coords[segment_id]
        if corridor.ends[segment_id][0] != node_a:
            segment_coords = segment_coords[::-1]  # walked against the way's direction
        coords += segment_coords[1:] if coords else segment_coords
        segment_ids.append(segment_id)
        pieces.append((segment_id, corridor.lengths[segment_id]))
    nodata_m = sum(
        length for segment_id, length in pieces if corridor.sun.get((segment_id, hour), NO_SHADE_ROW)[1] >= 1
    )
    return WalkPath(segment_ids, coords, pieces, sum(length for _, length in pieces), nodata_m, corridor.sun)


async def find_shadiest_path(google_coords: list[Point], start_at: datetime, feels_like: dict) -> WalkPath | None:
    start_hour = start_at.astimezone(IST).replace(minute=0, second=0, microsecond=0)
    corridor = await load_corridor({"type": "LineString", "coordinates": google_coords}, start_hour.month)
    start, end = nearest_node(corridor, google_coords[0]), nearest_node(corridor, google_coords[-1])
    if start is None or end is None or start == end:
        return None
    graph = build_graph(corridor, start_hour.hour, heat_weight(feels_like.get(start_hour)))
    nodes = await asyncio.to_thread(choose_nodes, graph, start, end)
    if nodes is None:
        return None
    return to_walk_path(nodes, graph, corridor, start_hour.hour)


async def load_walk_path(segment_ids: list[int], coords: list[Point], month: int) -> WalkPath:
    """Rebuilds a walk we planned earlier (from its segment ids) with that month's shade for every hour."""
    segments = {row["id"]: row for row in await load_segments(segment_ids)}
    sun = {
        (row["segment_id"], row["hour"]): (row["sun_fraction"], row["nodata_fraction"])
        for row in await load_segment_shade(segment_ids, month)
    }
    pieces = [(segment_id, segments[segment_id]["length_m"]) for segment_id in segment_ids]
    names = {segment_id: row["name"] for segment_id, row in segments.items()}
    return WalkPath(segment_ids, coords, pieces, sum(length for _, length in pieces), 0.0, sun, names)
