from app.db.pool import get_pool

IN_JOB_CELLS = "EXISTS (SELECT 1 FROM shade_cells c WHERE c.geohash = ANY($1) AND ST_Intersects(c.footprint, {geom}))"


async def load_unready_segments(cells: list[str]) -> list[tuple[int, list[tuple[float, float]]]]:
    rows = await get_pool().fetch(
        "SELECT s.id, ST_AsGeoJSON(s.geom)::json AS geometry FROM segments s "
        f"WHERE NOT s.shade_ready AND {IN_JOB_CELLS.format(geom='s.geom')}",
        cells,
    )
    return [(row["id"], [tuple(point) for point in row["geometry"]["coordinates"]]) for row in rows]


async def load_stops_in_cells(cells: list[str]) -> list[tuple[int, tuple[float, float]]]:
    rows = await get_pool().fetch(
        "SELECT st.id, ST_X(st.geom) AS lng, ST_Y(st.geom) AS lat FROM stops st "
        f"WHERE {IN_JOB_CELLS.format(geom='st.geom')}",
        cells,
    )
    return [(row["id"], (row["lng"], row["lat"])) for row in rows]


async def save_segment_shade(segment_ids: list[int], rows: list[tuple]) -> None:
    async with get_pool().acquire() as connection, connection.transaction():
        await connection.execute("DELETE FROM segment_shade WHERE segment_id = ANY($1)", segment_ids)
        await connection.copy_records_to_table(
            "segment_shade",
            records=rows,
            columns=["segment_id", "month", "hour", "sun_fraction", "nodata_fraction"],
        )
        await connection.execute("UPDATE segments SET shade_ready = true WHERE id = ANY($1)", segment_ids)


async def save_stop_shade(stop_ids: list[int], rows: list[tuple]) -> None:
    async with get_pool().acquire() as connection, connection.transaction():
        await connection.execute("DELETE FROM stop_shade WHERE stop_id = ANY($1)", stop_ids)
        await connection.copy_records_to_table(
            "stop_shade", records=rows, columns=["stop_id", "month", "hour", "sun_fraction"]
        )
