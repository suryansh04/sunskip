"""Queues shade jobs for the demo areas so the demo never waits. Usage: python -m scripts.preload --area muj"""

import argparse
import asyncio

from app.config import settings
from app.db.pool import open_pool
from app.db.shade_queries import find_cells_and_areas, get_area_statuses, get_cell_statuses, queue_job
from app.db.status_queries import get_solar_calls_this_month
from app.worker.overpass import run_overpass_query

PILOT_WALK = {"type": "LineString", "coordinates": [[75.56516, 26.84406], [75.56537, 26.83894]]}  # MUJ -> Bus 26 stop
MUJ_BUFFER_M = 300
JAIPUR_BBOX = "26.80,75.70,26.98,75.90"  # south, west, north, east
STATION_RADIUS_M = 500
STATION_QUERY = f'[out:json][timeout:50];node["railway"="station"]["station"="subway"]({JAIPUR_BBOX});out;'
DONE = {"READY", "NO_DATA"}


async def jaipur_metro_stations() -> list[dict]:
    nodes = await run_overpass_query(STATION_QUERY)
    return [{"type": "Point", "coordinates": [node["lon"], node["lat"]]} for node in nodes]


async def missing_work(area: dict, buffer_m: float) -> tuple[list[str], list[str]]:
    cells, areas = await find_cells_and_areas(area, buffer_m)
    cell_statuses = await get_cell_statuses(cells)
    area_statuses = await get_area_statuses(areas)
    return (
        [cell for cell in cells if cell_statuses.get(cell) not in DONE],
        [area_hash for area_hash in areas if area_statuses.get(area_hash) != "READY"],
    )


async def preload(areas_to_load: list[tuple[dict, float]]) -> None:
    cells, osm_areas = set(), set()
    for area, buffer_m in areas_to_load:
        area_cells, area_osm = await missing_work(area, buffer_m)
        cells.update(area_cells)
        osm_areas.update(area_osm)
    calls, budget = await get_solar_calls_this_month(), settings.solar_monthly_call_budget
    if calls + len(cells) > budget:
        print(f"Stopped: {len(cells)} cells would pass the Solar budget ({calls} used of {budget})")
        return
    ordered = sorted(cells)
    chunk = settings.max_cells_per_job
    for start in range(0, len(ordered), chunk):
        # The first job loads all the OSM areas; jobs run in order, so later ones find them ready
        job_osm = sorted(osm_areas) if start == 0 else []
        job_id = await queue_job("PRELOAD", None, ordered[start : start + chunk], job_osm)
        print(f"queued {job_id}")
    print(f"{len(cells)} cells and {len(osm_areas)} OSM areas queued")


async def main(area_name: str) -> None:
    await open_pool(settings.worker_pool_size)
    if area_name == "muj":
        await preload([(PILOT_WALK, MUJ_BUFFER_M)])
        return
    stations = await jaipur_metro_stations()
    print(f"{len(stations)} metro stations found")
    await preload([(station, STATION_RADIUS_M) for station in stations])


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--area", choices=["muj", "jaipur-metro"], required=True)
    asyncio.run(main(parser.parse_args().area))
