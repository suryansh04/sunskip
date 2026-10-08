"""Estimates walkers per segment (schema.md §4). The worker runs it nightly; run it by hand with:
python -m app.worker.demand"""

import asyncio
import logging
from datetime import datetime, time, timedelta

from app.config import IST, settings
from app.db.pool import get_pool, open_pool

logger = logging.getLogger("worker")
NIGHTLY_AT = time(2, 0)  # 02:00 IST

# poi walkers = sum of weight x exp(-distance / 150 m) for places within 400 m;
# app trips = trips in the last 30 days that used the segment (chosen option, else the top one)
DEMAND_SQL = """
WITH poi AS (
  SELECT s.id AS segment_id,
         COALESCE(sum(p.weight * exp(-ST_Distance(s.geom::geography, p.geom::geography) / $1)), 0) AS walkers
  FROM segments s
  LEFT JOIN pois p ON ST_DWithin(s.geom::geography, p.geom::geography, $2)
  WHERE s.shade_ready
  GROUP BY s.id
), app AS (
  SELECT seg_id, count(*) AS trips
  FROM (SELECT unnest(COALESCE(c.segment_ids, r.top_segment_ids)) AS seg_id
        FROM route_requests r LEFT JOIN route_choices c ON c.trip_id = r.id
        WHERE r.status = 'OK' AND r.created_at > now() - interval '30 days') used
  GROUP BY seg_id
)
INSERT INTO demand_estimates (segment_id, poi_walkers_per_day, app_trips_30d, walkers_per_day, computed_at)
SELECT poi.segment_id, poi.walkers, COALESCE(app.trips, 0), poi.walkers + COALESCE(app.trips, 0) / 30.0, now()
FROM poi LEFT JOIN app ON app.seg_id = poi.segment_id
ON CONFLICT (segment_id) DO UPDATE
SET poi_walkers_per_day = EXCLUDED.poi_walkers_per_day, app_trips_30d = EXCLUDED.app_trips_30d,
    walkers_per_day = EXCLUDED.walkers_per_day, computed_at = EXCLUDED.computed_at
"""


async def compute_demand() -> None:
    await get_pool().execute(DEMAND_SQL, settings.demand_decay_m, settings.demand_radius_m)
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
    print(await get_pool().fetchval("SELECT count(*) FROM demand_estimates"), "segments estimated")


if __name__ == "__main__":
    asyncio.run(compute_demand_now())
