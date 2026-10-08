"""Draws the v1 e-rickshaw zones as circles: one around MUJ, one around each Jaipur metro station we've loaded.
Run after the preloads: python -m scripts.seed_zones"""

import asyncio

from app.config import settings
from app.db.pool import open_pool
from app.db.walk_queries import load_metro_stations, save_erickshaw_zones

MUJ_CENTER = (75.56516, 26.84406)
MUJ_ZONE_NAME = "MUJ - Dehmi Kalan"
MUJ_ZONE_RADIUS_M = 3000  # reaches Dehmi Kalan
STATION_ZONE_RADIUS_M = 1500
BASE_FARE_INR = 10  # guesses until we collect real fares; the app labels them as estimates
PER_KM_INR = 10


async def seed_zones() -> None:
    await open_pool(settings.worker_pool_size)
    zones = [(MUJ_ZONE_NAME, *MUJ_CENTER, MUJ_ZONE_RADIUS_M)]
    zones += [
        (f"{station['name']} metro", station["lng"], station["lat"], STATION_ZONE_RADIUS_M)
        for station in await load_metro_stations()
    ]
    await save_erickshaw_zones([(*zone, BASE_FARE_INR, PER_KM_INR) for zone in zones])
    print(f"{len(zones)} e-rickshaw zones saved")


if __name__ == "__main__":
    asyncio.run(seed_zones())
