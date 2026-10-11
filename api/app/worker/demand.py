"""Estimates walkers per segment (api.md §8) with a small transport model, the textbook four-step one minus mode
choice:
1. trip generation: every place and stop creates walking trip ends a day (settings.trip_ends_per_day);
2. distribution: half of a place's trip ends start there, and go to the places of other kinds within a walk (a
   hostel's to classes, gates, stops and food, not to other hostels), more to bigger and nearer ones (a gravity
   model with exponential distance decay). OpenStreetMap misses most homes, shops and parking, so a share of the
   trips (settings.demand_unmapped_share) go to the path network itself instead: to every path in reach by its
   length, nearer ones more;
3. assignment: each trip is walked along the shortest path, and every segment counts the trips that cross it. People
   don't all agree on which way is shortest, so it is done several times with each path's length varied a little at
   random and averaged (Burrell's stochastic assignment); a path running beside a slightly shorter one still gets
   its share instead of none.
SunSkip trips are added on top. The worker runs it nightly; run it by hand with: python -m app.worker.demand"""

import asyncio
import heapq
import logging
import math
import random
from collections import defaultdict
from datetime import datetime, time, timedelta

from app.config import IST, settings
from app.db.demand_queries import count_demand_estimates, load_trip_places, load_walk_graph, save_demand
from app.db.pool import open_pool

logger = logging.getLogger("worker")
NIGHTLY_AT = time(2, 0)  # 02:00 IST
TRIP_STARTS_PER_END = 0.5  # every trip has two ends: half of a place's trip ends are trips starting there

Graph = dict[int, list[tuple[int, float, int]]]  # node -> [(next node, metres, segment id)]
TripEnds = dict[int, dict[str, float]]  # node -> {kind of place: trip ends a day}


def build_graph(rows: list, seed: int) -> Graph:
    """The path network, each segment's length seen as a little longer or shorter (seeded, so runs repeat)."""
    noise = random.Random(seed)
    spread = settings.demand_length_noise
    graph = defaultdict(list)
    for row in rows:
        length_m = row["length_m"] * noise.uniform(1 - spread, 1 + spread)
        graph[row["from_node"]].append((row["to_node"], length_m, row["id"]))
        graph[row["to_node"]].append((row["from_node"], length_m, row["id"]))
    return graph


def shortest_paths(graph: Graph, origin: int, max_m: float) -> tuple[dict, dict, list]:
    """Dijkstra up to max_m: distance to each node, the (node, segment) it is reached from, and the nodes in the
    order they were settled (nearest first)."""
    distance, reached_from, settled = {origin: 0.0}, {}, []
    queue = [(0.0, origin)]
    while queue:
        metres, node = heapq.heappop(queue)
        if metres > distance[node]:
            continue
        settled.append(node)
        for next_node, length_m, segment_id in graph[node]:
            next_metres = metres + length_m
            if next_metres <= max_m and next_metres < distance.get(next_node, math.inf):
                distance[next_node] = next_metres
                reached_from[next_node] = (node, segment_id)
                heapq.heappush(queue, (next_metres, next_node))
    return distance, reached_from, settled


def trips_arriving(origin: int, kind: str, trip_ends: TripEnds, distance: dict) -> dict[int, float]:
    """Where the trips starting at the origin's places of this kind go: other kinds of place, bigger and nearer
    ones pulling more."""
    pull = {
        node: sum(ends for other, ends in kinds.items() if other != kind)
        * math.exp(-distance[node] / settings.demand_decay_m)
        for node, kinds in trip_ends.items()
        if node != origin and node in distance
    }
    total_pull = sum(pull.values())
    if not total_pull:
        return {}
    starting = trip_ends[origin][kind] * TRIP_STARTS_PER_END * (1 - settings.demand_unmapped_share)
    return {node: starting * share / total_pull for node, share in pull.items()}


def unmapped_trips_arriving(origin: int, trip_ends: TripEnds, node_metres: dict, distance: dict) -> dict[int, float]:
    """The trips that go to places OpenStreetMap doesn't have, spread over the paths in reach by their length."""
    pull = {node: node_metres[node] * math.exp(-metres / settings.demand_decay_m) for node, metres in distance.items()}
    total_pull = sum(pull.values())
    starting = sum(trip_ends[origin].values()) * TRIP_STARTS_PER_END * settings.demand_unmapped_share
    return {node: starting * share / total_pull for node, share in pull.items()} if total_pull else {}


def walk_trips_from(
    origin: int, trip_ends: TripEnds, node_metres: dict, graph: Graph, walkers: dict[int, float]
) -> None:
    """Walks the trips starting at origin back along its shortest-path tree, so each segment gets every trip whose
    path crosses it."""
    distance, reached_from, settled = shortest_paths(graph, origin, settings.demand_max_walk_m)
    arriving = defaultdict(float, unmapped_trips_arriving(origin, trip_ends, node_metres, distance))
    for kind in trip_ends[origin]:
        for node, trips in trips_arriving(origin, kind, trip_ends, distance).items():
            arriving[node] += trips
    # Farthest first: a node passes everything that arrives at or beyond it to the segment it was reached by
    for node in reversed(settled):
        if node not in reached_from or not arriving[node]:
            continue
        previous, segment_id = reached_from[node]
        walkers[segment_id] += arriving[node]
        arriving[previous] += arriving[node]


def model_walkers(rows: list, places: list) -> dict[int, float]:
    trip_ends = defaultdict(lambda: defaultdict(float))
    for place in places:
        trip_ends[place["node"]][place["kind"]] += settings.trip_ends_per_day[place["kind"]]
    node_metres = defaultdict(float)  # half of each path touching a node: the path length it stands for
    for row in rows:
        node_metres[row["from_node"]] += row["length_m"] / 2
        node_metres[row["to_node"]] += row["length_m"] / 2
    runs = settings.demand_assignment_runs
    walkers = defaultdict(float)
    for seed in range(runs):
        graph = build_graph(rows, seed)
        for origin in trip_ends:
            walk_trips_from(origin, trip_ends, node_metres, graph, walkers)
    return {segment_id: total / runs for segment_id, total in walkers.items()}


async def compute_demand() -> None:
    rows = await load_walk_graph()
    places = await load_trip_places(settings.demand_snap_m)
    walkers = model_walkers(rows, places)
    await save_demand({row["id"]: walkers.get(row["id"], 0.0) for row in rows})
    logger.info("Demand estimates updated: %d places, %d segments", len(places), len(rows))


def seconds_until_nightly_run() -> float:
    now = datetime.now(IST)
    next_run = datetime.combine(now.date(), NIGHTLY_AT, IST)
    if next_run <= now:
        next_run += timedelta(days=1)
    return (next_run - now).total_seconds()


async def run_demand_nightly() -> None:
    while True:
        await asyncio.sleep(seconds_until_nightly_run())
        try:
            await compute_demand()
        except Exception:
            logger.exception("Demand job failed")


async def compute_demand_now() -> None:
    await open_pool(settings.worker_pool_size)
    await compute_demand()
    print(await count_demand_estimates(), "segments estimated")


if __name__ == "__main__":
    asyncio.run(compute_demand_now())
