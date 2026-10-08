import asyncio
import logging

from app.db.shade_queries import finish_job
from app.worker.overpass import load_osm_area
from app.worker.scoring import score_cells
from app.worker.solar import fetch_cells

logger = logging.getLogger("worker")


async def load_osm_areas(areas: list[str]) -> None:
    for geohash6 in areas:  # one Overpass call at a time (public server rule)
        await load_osm_area(geohash6)


async def run_job(job) -> None:
    logger.info("Job %s: %d areas, %d cells", job["id"], len(job["osm_areas"]), len(job["cells"]))
    try:
        # OSM and Solar don't depend on each other, so fetch both at once; scoring needs both
        await asyncio.gather(load_osm_areas(job["osm_areas"]), fetch_cells(job["id"], job["cells"]))
        await score_cells(job["cells"])
    except Exception as error:
        logger.exception("Job %s failed", job["id"])
        await finish_job(job["id"], "FAILED", type(error).__name__)
        return
    await finish_job(job["id"], "DONE", None)
    logger.info("Job %s done", job["id"])
