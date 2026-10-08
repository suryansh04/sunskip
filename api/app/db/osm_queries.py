from app.db.pool import get_pool


async def get_area_bbox(geohash6: str) -> tuple[float, float, float, float]:
    """(south, west, north, east), the order Overpass wants."""
    row = await get_pool().fetchrow(
        "SELECT ST_YMin(footprint) AS s, ST_XMin(footprint) AS w, ST_YMax(footprint) AS n, ST_XMax(footprint) AS e "
        "FROM osm_areas WHERE geohash = $1",
        geohash6,
    )
    return row["s"], row["w"], row["n"], row["e"]


async def set_area_status(geohash6: str, status: str) -> None:
    fetched_at = "now()" if status == "READY" else "fetched_at"
    await get_pool().execute(
        f"UPDATE osm_areas SET status = $2, fetched_at = {fetched_at} WHERE geohash = $1", geohash6, status
    )


async def mark_area_failed(geohash6: str, error: str) -> None:
    await get_pool().execute(
        "UPDATE osm_areas SET status = 'ERROR', attempts = attempts + 1, last_error = $2 WHERE geohash = $1",
        geohash6,
        error,
    )


async def save_walk_graph(node_rows: list[tuple], segment_rows: list[tuple]) -> None:
    async with get_pool().acquire() as connection, connection.transaction():
        await connection.executemany(
            "INSERT INTO graph_nodes (id, geom) VALUES ($1, ST_Point($2, $3, 4326)) ON CONFLICT DO NOTHING",
            node_rows,
        )
        await connection.executemany(
            """
            INSERT INTO segments (from_node, to_node, osm_way_id, way_seq, highway, name, geom, length_m)
            VALUES ($1, $2, $3, $4, $5, $6, ST_MakeLine(ST_Point($7, $8, 4326), ST_Point($9, $10, 4326)), $11)
            ON CONFLICT (osm_way_id, way_seq) DO NOTHING
            """,
            segment_rows,
        )


async def save_stops(stop_rows: list[tuple]) -> None:
    await get_pool().executemany(
        """
        INSERT INTO stops (kind, name, osm_node_id, geom, has_shelter)
        VALUES ($1, $2, $3, ST_Point($4, $5, 4326), $6)
        ON CONFLICT (osm_node_id) DO NOTHING
        """,
        stop_rows,
    )


async def save_pois(poi_rows: list[tuple]) -> None:
    await get_pool().executemany(
        """
        INSERT INTO pois (osm_id, kind, name, geom, weight)
        VALUES ($1, $2, $3, ST_Point($4, $5, 4326), $6)
        ON CONFLICT (osm_id) DO NOTHING
        """,
        poi_rows,
    )
