import asyncio
import logging

from app.config import settings
from app.db.pool import open_pool
from app.db.shade_queries import claim_next_job, requeue_stuck_work
from app.db.status_queries import record_worker_heartbeat
from app.worker.job import run_job

logger = logging.getLogger("worker")


async def beat_forever() -> None:
    while True:
        try:
            await record_worker_heartbeat()
            await requeue_stuck_work(settings.stuck_after_minutes)
        except Exception:
            logger.exception("Heartbeat failed")
        await asyncio.sleep(settings.heartbeat_interval_s)


async def run_worker() -> None:
    await open_pool(settings.worker_pool_size)
    heartbeat_task = asyncio.create_task(beat_forever())  # kept in a variable so it isn't garbage-collected
    logger.info("Worker started")
    while not heartbeat_task.done():
        job = await claim_next_job()
        if job is None:
            await asyncio.sleep(settings.worker_idle_sleep_s)
            continue
        await run_job(job)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(run_worker())
