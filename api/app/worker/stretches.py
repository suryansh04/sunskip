"""Joins neighbouring segments into the stretches officials see. Run on its own to rebuild every area:
python -m app.worker.stretches"""

import asyncio
from collections import Counter, defaultdict

import asyncpg

from app.config import settings
from app.db.pool import open_pool
from app.db.stretch_queries import (
    count_node_segments,
    count_stretches,
    list_ready_cells,
    load_segments_for_stretches,
    replace_stretches,
)

SEGMENTS_IN_A_LINE = 2  # a node with exactly two segments is a plain bend, not a junction


def find_root(parents: dict[int, int], item: int) -> int:
    while parents[item] != item:
        parents[item] = parents[parents[item]]
        item = parents[item]
    return item


def group_segments(rows: list[asyncpg.Record], node_degrees: dict[int, int]) -> list[tuple[str | None, list[int]]]:
    """Two segments join when the node between them has only those two, and their sun differs by < 0.2."""
    parents = {row["id"]: row["id"] for row in rows}
    sun = {row["id"]: row["sun"] for row in rows}
    segments_at_node = defaultdict(list)
    for row in rows:
        segments_at_node[row["from_node"]].append(row["id"])
        segments_at_node[row["to_node"]].append(row["id"])
    for node, segment_ids in segments_at_node.items():
        if len(segment_ids) != SEGMENTS_IN_A_LINE or node_degrees.get(node) != SEGMENTS_IN_A_LINE:
            continue
        if abs(sun[segment_ids[0]] - sun[segment_ids[1]]) < settings.stretch_sun_diff:
            parents[find_root(parents, segment_ids[0])] = find_root(parents, segment_ids[1])
    groups = defaultdict(list)
    for row in rows:
        groups[find_root(parents, row["id"])].append(row)
    return [(most_common_name(members), [member["id"] for member in members]) for members in groups.values()]


def most_common_name(rows: list[asyncpg.Record]) -> str | None:
    names = Counter(row["name"] for row in rows if row["name"])
    return names.most_common(1)[0][0] if names else None


async def rebuild_stretches(cells: list[str]) -> None:
    rows = await load_segments_for_stretches(cells)
    if not rows:
        return
    nodes = list({node for row in rows for node in (row["from_node"], row["to_node"])})
    await replace_stretches(group_segments(rows, await count_node_segments(nodes)))


async def rebuild_all_stretches() -> None:
    await open_pool(settings.worker_pool_size)
    await rebuild_stretches(await list_ready_cells())
    print(await count_stretches(), "stretches")


if __name__ == "__main__":
    asyncio.run(rebuild_all_stretches())
