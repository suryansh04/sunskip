import json
from datetime import date
from uuid import UUID

from app.db.pool import get_pool

CELL_GRID_DEG = 0.0003  # sample spacing small enough to hit every ~150 m geohash cell

CELLS_FOR_AREA_SQL = """
WITH corr AS (SELECT ST_Buffer(ST_GeomFromGeoJSON($1)::geography, $2)::geometry AS c),
pts AS (SELECT ST_Centroid(sq.geom) AS p FROM corr, ST_SquareGrid($3, corr.c) sq)
SELECT array_agg(DISTINCT ST_GeoHash(p, 7)) AS cells, array_agg(DISTINCT ST_GeoHash(p, 6)) AS osm_areas
FROM pts, corr WHERE ST_Intersects(p, c)
"""


async def find_cells_and_areas(area: dict, buffer_m: float) -> tuple[list[str], list[str]]:
    row = await get_pool().fetchrow(CELLS_FOR_AREA_SQL, json.dumps(area), buffer_m, CELL_GRID_DEG)
    return row["cells"] or [], row["osm_areas"] or []


async def get_cell_statuses(cells: list[str]) -> dict[str, str]:
    rows = await get_pool().fetch("SELECT geohash, status FROM shade_cells WHERE geohash = ANY($1)", cells)
    return {row["geohash"]: row["status"] for row in rows}


async def get_area_statuses(areas: list[str]) -> dict[str, str]:
    rows = await get_pool().fetch("SELECT geohash, status FROM osm_areas WHERE geohash = ANY($1)", areas)
    return {row["geohash"]: row["status"] for row in rows}


async def find_active_job(cells: list[str]):
    return await get_pool().fetchrow(
        "SELECT id, cells, cells_done FROM shade_jobs WHERE status IN ('QUEUED', 'RUNNING') "
        "AND cells && $1 ORDER BY created_at DESC LIMIT 1",
        cells,
    )


async def count_client_cells_today(client_hash: str) -> int:
    return await get_pool().fetchval(
        "SELECT COALESCE(sum(cardinality(cells)), 0) FROM shade_jobs "
        "WHERE client_hash = $1 AND created_at > now() - interval '1 day'",
        client_hash,
    )


async def queue_job(reason: str, client_hash: str | None, cells: list[str], areas: list[str]) -> str:
    async with get_pool().acquire() as connection, connection.transaction():
        await connection.execute(
            """
            INSERT INTO shade_cells (geohash, footprint)
            SELECT h, ST_SetSRID(ST_Box2dFromGeoHash(h)::geometry, 4326) FROM unnest($1::text[]) h
            ON CONFLICT (geohash) DO UPDATE SET status = 'PENDING', attempts = 0, last_error = NULL
            WHERE shade_cells.status IN ('ERROR', 'BUDGET_EXCEEDED')
            """,
            cells,
        )
        await connection.execute(
            """
            INSERT INTO osm_areas (geohash, footprint)
            SELECT h, ST_SetSRID(ST_Box2dFromGeoHash(h)::geometry, 4326) FROM unnest($1::text[]) h
            ON CONFLICT (geohash) DO UPDATE SET status = 'PENDING', attempts = 0
            WHERE osm_areas.status = 'ERROR'
            """,
            areas,
        )
        job_id = await connection.fetchval(
            "INSERT INTO shade_jobs (reason, client_hash, osm_areas, cells) VALUES ($1, $2, $3, $4) RETURNING id",
            reason,
            client_hash,
            areas,
            cells,
        )
    return str(job_id)


async def claim_next_job():
    return await get_pool().fetchrow(
        """
        UPDATE shade_jobs SET status = 'RUNNING', started_at = now()
        WHERE id = (SELECT id FROM shade_jobs WHERE status = 'QUEUED'
                    ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
        RETURNING id, osm_areas, cells
        """
    )


async def requeue_stuck_work(stuck_after_minutes: int) -> None:
    await get_pool().execute(
        "UPDATE shade_jobs SET status = 'QUEUED', started_at = NULL "
        "WHERE status = 'RUNNING' AND started_at < now() - make_interval(mins => $1)",
        stuck_after_minutes,
    )
    await get_pool().execute(
        "UPDATE shade_cells SET status = 'PENDING' "
        "WHERE status = 'FETCHING' AND requested_at < now() - make_interval(mins => $1)",
        stuck_after_minutes,
    )


async def finish_job(job_id: UUID, status: str, error: str | None) -> None:
    await get_pool().execute(
        "UPDATE shade_jobs SET status = $2, error = $3, finished_at = now() WHERE id = $1",
        job_id,
        status,
        error,
    )


async def claim_cell(geohash: str):
    """Moves a PENDING cell to FETCHING and returns its centre, or None if someone else has it."""
    return await get_pool().fetchrow(
        "UPDATE shade_cells SET status = 'FETCHING', requested_at = now() "
        "WHERE geohash = $1 AND status = 'PENDING' "
        "RETURNING ST_Y(ST_Centroid(footprint)) AS lat, ST_X(ST_Centroid(footprint)) AS lng",
        geohash,
    )


async def count_solar_call() -> int:
    return await get_pool().fetchval(
        """
        INSERT INTO solar_usage (month_start, calls)
        VALUES (date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata')::date, 1)
        ON CONFLICT (month_start) DO UPDATE SET calls = solar_usage.calls + 1
        RETURNING calls
        """
    )


async def set_cell_status(geohash: str, status: str) -> None:
    await get_pool().execute("UPDATE shade_cells SET status = $2 WHERE geohash = $1", geohash, status)


async def mark_cell_ready(geohash: str, imagery_date: date, quality: str | None, prefix: str) -> None:
    await get_pool().execute(
        "UPDATE shade_cells SET status = 'READY', imagery_date = $2, imagery_quality = $3, "
        "s3_prefix = $4, ready_at = now() WHERE geohash = $1",
        geohash,
        imagery_date,
        quality,
        prefix,
    )


async def record_cell_failure(geohash: str, error: str, give_up: bool) -> None:
    await get_pool().execute(
        "UPDATE shade_cells SET attempts = attempts + 1, last_error = $2, "
        "status = CASE WHEN $3 THEN 'ERROR' ELSE status END WHERE geohash = $1",
        geohash,
        error,
        give_up,
    )


async def count_cell_done(job_id: UUID, no_data: bool) -> None:
    await get_pool().execute(
        "UPDATE shade_jobs SET cells_done = cells_done + 1, cells_no_data = cells_no_data + $2 WHERE id = $1",
        job_id,
        int(no_data),
    )


async def get_job(job_id: UUID):
    return await get_pool().fetchrow(
        "SELECT id, status, reason, cardinality(cells) AS cells_total, cells_done, cells_no_data "
        "FROM shade_jobs WHERE id = $1",
        job_id,
    )
