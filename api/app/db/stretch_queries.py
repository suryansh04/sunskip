from app.db.pool import get_pool

STRETCH_MONTH = 5  # stretches are grouped by May midday sun, the worst case (schema.md §4)
STRETCH_HOURS = (10, 16)


async def load_segments_for_stretches(cells: list[str]):
    """Shade-ready segments in these cells, with their average May midday sun."""
    return await get_pool().fetch(
        """
        SELECT s.id, s.from_node, s.to_node, s.name, COALESCE(avg(sh.sun_fraction), 0) AS sun
        FROM segments s
        LEFT JOIN segment_shade sh ON sh.segment_id = s.id AND sh.month = $2 AND sh.hour BETWEEN $3 AND $4
        WHERE s.shade_ready
          AND EXISTS (SELECT 1 FROM shade_cells c WHERE c.geohash = ANY($1) AND ST_Intersects(c.footprint, s.geom))
        GROUP BY s.id
        """,
        cells,
        STRETCH_MONTH,
        *STRETCH_HOURS,
    )


async def replace_stretches(groups: list[tuple[str | None, list[int]]]) -> None:
    """Drops the old stretches of these segments and saves the new groups as stretches."""
    segment_ids = [segment_id for _, ids in groups for segment_id in ids]
    async with get_pool().acquire() as connection, connection.transaction():
        await connection.execute(
            "DELETE FROM stretches WHERE id IN (SELECT stretch_id FROM segments WHERE id = ANY($1))", segment_ids
        )
        for name, ids in groups:
            stretch_id = await connection.fetchval(
                "INSERT INTO stretches (name, geom, length_m) "
                "SELECT $1, ST_Multi(ST_LineMerge(ST_Collect(geom))), sum(length_m) FROM segments WHERE id = ANY($2) "
                "RETURNING id",
                name,
                ids,
            )
            await connection.execute("UPDATE segments SET stretch_id = $1 WHERE id = ANY($2)", stretch_id, ids)
