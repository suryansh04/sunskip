import logging

import asyncpg

from app.db.shade_queries import finish_job, list_done_cells_in_areas, release_unfinished_cells
from app.worker.overpass import load_osm_area
from app.worker.scoring import score_cells
from app.worker.solar import fetch_cells, gather_all
from app.worker.stretches import rebuild_stretches

logger = logging.getLogger("worker")


async def load_osm_areas(areas: list[str]) -> None:
    for geohash6 in areas:  # one Overpass call at a time (public server rule)
        await load_osm_area(geohash6)


async def fetch_job_data(job: asyncpg.Record) -> Exception | None:
    """Downloads the job's map areas and shade cells. Returns the first error, after everything has stopped."""
    try:
        # OSM and Solar don't depend on each other, so fetch both at once
        await gather_all(load_osm_areas(job["osm_areas"]), fetch_cells(job["id"], job["cells"]))
    except Exception as error:
        logger.exception("Job %s: download failed", job["id"])
        return error
    return None


async def score_job_area(job: asyncpg.Record) -> Exception | None:
    """Scores the paths in the job's cells, plus fetched cells inside its map areas (new paths can sit in cells
    an earlier job fetched, e.g. when the map server was busy then). Returns the error, if any."""
    try:
        cells = sorted(set(job["cells"]) | set(await list_done_cells_in_areas(job["osm_areas"])))
        await score_cells(cells)
        await rebuild_stretches(cells)
    except Exception as error:
        logger.exception("Job %s: scoring failed", job["id"])
        return error
    return None


async def run_job(job: asyncpg.Record) -> None:
    logger.info("Job %s: %d areas, %d cells", job["id"], len(job["osm_areas"]), len(job["cells"]))
    download_error = await fetch_job_data(job)
    # Score even after a failed download: a path only counts as ready once every point on it has shade data
    error = await score_job_area(job) or download_error
    if error:
        await release_unfinished_cells(job["cells"])
        await finish_job(job["id"], "FAILED", type(error).__name__)
        logger.info("Job %s failed", job["id"])
        return
    await finish_job(job["id"], "DONE", None)
    logger.info("Job %s done", job["id"])
