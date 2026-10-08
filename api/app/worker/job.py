import logging

from app.db.shade_queries import finish_job
from app.worker.overpass import load_osm_area
from app.worker.scoring import score_cells
from app.worker.solar import fetch_cells

logger = logging.getLogger("worker")


async def run_job(job) -> None:
    logger.info("Job %s: %d areas, %d cells", job["id"], len(job["osm_areas"]), len(job["cells"]))
    try:
        for geohash6 in job["osm_areas"]:
            await load_osm_area(geohash6)
        await fetch_cells(job["id"], job["cells"])
        await score_cells(job["cells"])
    except Exception as error:
        logger.exception("Job %s failed", job["id"])
        await finish_job(job["id"], "FAILED", type(error).__name__)
        return
    await finish_job(job["id"], "DONE", None)
    logger.info("Job %s done", job["id"])
