import asyncio
import logging
from datetime import date
from uuid import UUID

import httpx

from app.config import settings
from app.core.http import http_client, track_service
from app.core.storage import save_file
from app.db.shade_queries import (
    claim_cell,
    count_cell_done,
    count_solar_call,
    mark_cell_ready,
    record_cell_failure,
    set_cell_status,
)

SOLAR_URL = "https://solar.googleapis.com/v1/dataLayers:get"
SOLAR_RADIUS_M = 100  # a 200 x 200 m tile, enough to cover one ~150 m cell
DOWNLOAD_TIMEOUT_S = 60  # each GeoTIFF is a few MB
MAX_ATTEMPTS = 3
QUALITIES = {"HIGH", "MEDIUM", "BASE"}

logger = logging.getLogger("worker")


async def get_data_layers(lat: float, lng: float) -> dict | None:
    params = {
        "location.latitude": lat,
        "location.longitude": lng,
        "radiusMeters": SOLAR_RADIUS_M,
        "view": "FULL_LAYERS",
        "requiredQuality": "BASE",
        "pixelSizeMeters": 1,
        "key": settings.google_api_key,
    }
    async with track_service("google_solar"):
        response = await http_client.get(SOLAR_URL, params=params)
        if response.status_code == 404:
            return None  # Google has no shade data here
        response.raise_for_status()
    return response.json()


async def download_layer(url: str) -> bytes:
    # The download links need our key added and expire in about an hour
    response = await http_client.get(f"{url}&key={settings.google_api_key}", timeout=DOWNLOAD_TIMEOUT_S)
    response.raise_for_status()
    return response.content


async def save_cell_files(geohash: str, layers: dict) -> None:
    urls = {f"month_{month:02d}.tif": url for month, url in enumerate(layers["hourlyShadeUrls"], start=1)}
    urls["dsm.tif"] = layers["dsmUrl"]
    contents = await asyncio.gather(*(download_layer(url) for url in urls.values()))
    for name, content in zip(urls, contents, strict=True):
        await asyncio.to_thread(save_file, f"shade/{geohash}/{name}", content)


async def download_cell(geohash: str, lat: float, lng: float) -> bool:
    """Fetches one cell. Returns True when Google has no data there."""
    if await count_solar_call() > settings.solar_monthly_call_budget:
        await set_cell_status(geohash, "BUDGET_EXCEEDED")
        return False
    layers = await get_data_layers(lat, lng)
    if layers is None:
        await set_cell_status(geohash, "NO_DATA")
        return True
    await save_cell_files(geohash, layers)
    imagery = layers["imageryDate"]
    quality = layers.get("imageryQuality") if layers.get("imageryQuality") in QUALITIES else None
    await mark_cell_ready(
        geohash, date(imagery["year"], imagery["month"], imagery["day"]), quality, f"shade/{geohash}/"
    )
    return False


async def fetch_cell(geohash: str) -> bool:
    center = await claim_cell(geohash)
    if center is None:
        return False
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            return await download_cell(geohash, center["lat"], center["lng"])
        except (httpx.HTTPError, OSError, KeyError) as error:
            logger.warning("Cell %s attempt %d failed: %s", geohash, attempt, type(error).__name__)
            await record_cell_failure(geohash, type(error).__name__, give_up=attempt == MAX_ATTEMPTS)
    return False


async def fetch_cells(job_id: UUID, cells: list[str]) -> None:
    limit = asyncio.Semaphore(settings.worker_solar_concurrency)

    async def fetch_and_count(geohash: str) -> None:
        async with limit:
            no_data = await fetch_cell(geohash)
        await count_cell_done(job_id, no_data)

    await asyncio.gather(*(fetch_and_count(geohash) for geohash in cells))
