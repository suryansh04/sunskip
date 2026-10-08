"""Draws the v1 e-rickshaw zones as circles: one around MUJ, one around each Jaipur metro station we've loaded.
Run after the preloads: python -m scripts.seed_zones"""

import asyncio

from app.config import settings
from app.db.pool import get_pool, open_pool

MUJ_CENTER = (75.56516, 26.84406)
MUJ_ZONE_NAME = "MUJ - Dehmi Kalan"
MUJ_ZONE_RADIUS_M = 3000  # reaches Dehmi Kalan
STATION_ZONE_RADIUS_M = 1500
BASE_FARE_INR = 10  # guesses until we collect real fares; the app labels them as estimates
PER_KM_INR = 10

UPSERT_ZONE = """
INSERT INTO erickshaw_zones (name, geom, base_fare_inr, per_km_inr, fare_source, notes)
VALUES ($1, ST_Buffer(ST_Point($2, $3, 4326)::geography, $4)::geometry, $5, $6, 'FORMULA', 'circle, v1')
ON CONFLICT (name) DO UPDATE SET geom = EXCLUDED.geom, base_fare_inr = EXCLUDED.base_fare_inr,
    per_km_inr = EXCLUDED.per_km_inr
"""


async def seed_zones() -> None:
    await open_pool(settings.worker_pool_size)
    pool = get_pool()
    stations = await pool.fetch(
        "SELECT DISTINCT ON (name) name, ST_X(geom) AS lng, ST_Y(geom) AS lat FROM stops WHERE kind = 'METRO'"
    )
    zones = [(MUJ_ZONE_NAME, *MUJ_CENTER, MUJ_ZONE_RADIUS_M)]
    zones += [
        (f"{station['name']} metro", station["lng"], station["lat"], STATION_ZONE_RADIUS_M) for station in stations
    ]
    await pool.executemany(UPSERT_ZONE, [(*zone, BASE_FARE_INR, PER_KM_INR) for zone in zones])
    print(f"{len(zones)} e-rickshaw zones saved")


if __name__ == "__main__":
    asyncio.run(seed_zones())
