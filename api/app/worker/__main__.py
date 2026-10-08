import asyncio
import logging

from app.config import settings
from app.db.pool import open_pool
from app.db.shade_queries import claim_next_job, requeue_interrupted_work
from app.db.status_queries import record_worker_heartbeat
from app.worker.demand import run_demand_nightly
from app.worker.job import run_job

logger = logging.getLogger("worker")


async def beat_forever() -> None:
    while True:
        try:
            await record_worker_heartbeat()
        except Exception:
            logger.exception("Heartbeat failed")
        await asyncio.sleep(settings.heartbeat_interval_s)


async def run_worker() -> None:
    await open_pool(settings.worker_pool_size)
    await requeue_interrupted_work()
    # Kept in a list so the background tasks aren't garbage-collected
    background = [asyncio.create_task(beat_forever()), asyncio.create_task(run_demand_nightly())]
    logger.info("Worker started")
    while not any(task.done() for task in background):
        job = await claim_next_job()
        if job is None:
            await asyncio.sleep(settings.worker_idle_sleep_s)
            continue
        await run_job(job)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(run_worker())
