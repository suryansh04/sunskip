import asyncio
import logging

from app.config import settings
from app.db.pool import open_pool
from app.db.shade_queries import claim_next_job, requeue_interrupted_work
from app.db.status_queries import record_worker_heartbeat
from app.worker.demand import run_demand_nightly
from app.worker.job import run_job

logger = logging.getLogger("worker")
MAX_BACKOFF_S = 60


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
    failures = 0
    while not any(task.done() for task in background):
        try:
            job = await claim_next_job()
            if job is None:
                await asyncio.sleep(settings.worker_idle_sleep_s)
            else:
                await run_job(job)
            failures = 0
        except Exception:
            # A database blip shouldn't kill the worker: back off (up to a minute) and try again
            failures += 1
            logger.exception("Worker loop failed (%d in a row)", failures)
            await asyncio.sleep(min(MAX_BACKOFF_S, 2**failures))


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(run_worker())
