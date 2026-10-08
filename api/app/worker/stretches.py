"""Joins neighbouring segments into the stretches officials see. Run on its own to rebuild every area:
python -m app.worker.stretches"""

import asyncio
from collections import Counter, defaultdict

from app.config import settings
from app.db.pool import get_pool, open_pool
from app.db.stretch_queries import load_segments_for_stretches, replace_stretches


def find_root(parents: dict[int, int], item: int) -> int:
    while parents[item] != item:
        parents[item] = parents[parents[item]]
        item = parents[item]
    return item


def group_segments(rows: list) -> list[tuple[str | None, list[int]]]:
    """Two segments join when the node between them has only those two, and their sun differs by < 0.2."""
    parents = {row["id"]: row["id"] for row in rows}
    sun = {row["id"]: row["sun"] for row in rows}
    segments_at_node = defaultdict(list)
    for row in rows:
        segments_at_node[row["from_node"]].append(row["id"])
        segments_at_node[row["to_node"]].append(row["id"])
    for segment_ids in segments_at_node.values():
        if len(segment_ids) == 2 and abs(sun[segment_ids[0]] - sun[segment_ids[1]]) < settings.stretch_sun_diff:
            parents[find_root(parents, segment_ids[0])] = find_root(parents, segment_ids[1])
    groups = defaultdict(list)
    for row in rows:
        groups[find_root(parents, row["id"])].append(row)
    return [(most_common_name(members), [member["id"] for member in members]) for members in groups.values()]


def most_common_name(rows: list) -> str | None:
    names = Counter(row["name"] for row in rows if row["name"])
    return names.most_common(1)[0][0] if names else None


async def rebuild_stretches(cells: list[str]) -> None:
    rows = await load_segments_for_stretches(cells)
    if rows:
        await replace_stretches(group_segments(rows))


async def rebuild_all_stretches() -> None:
    await open_pool(settings.worker_pool_size)
    cells = [row["geohash"] for row in await get_pool().fetch("SELECT geohash FROM shade_cells WHERE status = 'READY'")]
    await rebuild_stretches(cells)
    print(await get_pool().fetchval("SELECT count(*) FROM stretches"), "stretches")


if __name__ == "__main__":
    asyncio.run(rebuild_all_stretches())
