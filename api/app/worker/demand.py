"""Estimates walkers per segment (schema.md §4). The worker runs it nightly; run it by hand with:
python -m app.worker.demand"""

import asyncio
import logging
from datetime import datetime, time, timedelta

from app.config import IST, settings
from app.db.demand_queries import count_demand_estimates, update_demand
from app.db.pool import open_pool

logger = logging.getLogger("worker")
NIGHTLY_AT = time(2, 0)  # 02:00 IST


async def compute_demand() -> None:
    await update_demand(settings.demand_decay_m, settings.demand_radius_m)
    logger.info("Demand estimates updated")


def seconds_until_nightly_run() -> float:
    now = datetime.now(IST)
    next_run = datetime.combine(now.date(), NIGHTLY_AT, IST)
    if next_run <= now:
        next_run += timedelta(days=1)
    return (next_run - now).total_seconds()


async def run_demand_nightly() -> None:
    while True:
        await asyncio.sleep(seconds_until_nightly_run())
        try:
            await compute_demand()
        except Exception:
            logger.exception("Demand job failed")


async def compute_demand_now() -> None:
    await open_pool(settings.worker_pool_size)
    await compute_demand()
    print(await count_demand_estimates(), "segments estimated")


if __name__ == "__main__":
    asyncio.run(compute_demand_now())
