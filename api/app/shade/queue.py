from asyncpg import Record

from app.config import settings
from app.contracts.models import Shade
from app.db.shade_queries import (
    count_client_cells_today,
    find_active_job,
    find_cells_and_areas,
    get_area_statuses,
    get_cell_statuses,
    queue_job,
)
from app.db.status_queries import get_solar_calls_this_month

INDIA_BBOX = (68.1, 6.5, 97.5, 35.7)  # west, south, east, north; a rough box around India
IN_PROGRESS = {"PENDING", "FETCHING"}
DONE = {"READY", "NO_DATA"}  # cells we never need to fetch again


def preparing(job_id: str, cells_total: int, cells_done: int) -> Shade:
    return Shade(
        status="PREPARING",
        job_id=job_id,
        cells_total=cells_total,
        cells_done=cells_done,
        poll_after_seconds=settings.poll_after_seconds,
    )


async def cells_allowed(client_hash: str | None) -> int:
    """How many new cells this request may queue: none once the month's Solar budget is used,
    and a device only gets what's left of its daily allowance."""
    if await get_solar_calls_this_month() >= settings.solar_monthly_call_budget:
        return 0
    if client_hash is None:
        return settings.max_cells_per_job
    left_today = settings.max_new_cells_per_client_per_day - await count_client_cells_today(client_hash)
    return max(0, min(settings.max_cells_per_job, left_today))


def points_of(coordinates: list) -> list[list[float]]:
    """Every [lng, lat] in any GeoJSON geometry's (nested) coordinates."""
    if coordinates and isinstance(coordinates[0], int | float):
        return [coordinates]
    return [point for part in coordinates for point in points_of(part)]


def inside_india(area: dict) -> bool:
    west, south, east, north = INDIA_BBOX
    return all(west <= lng <= east and south <= lat <= north for lng, lat in points_of(area["coordinates"]))


async def find_missing_work(cells: list[str], areas: list[str]) -> tuple[list[str], list[str], dict, Record | None]:
    """(missing cells, missing OSM areas, cell statuses, active job). Work left in progress without a live job
    (its job failed or was cut off) counts as missing, so it gets queued again."""
    cell_statuses = await get_cell_statuses(cells)
    area_statuses = await get_area_statuses(areas)
    busy_cells = [cell for cell in cells if cell_statuses.get(cell) in IN_PROGRESS]
    busy_areas = [area_hash for area_hash in areas if area_statuses.get(area_hash) in IN_PROGRESS]
    active_job = await find_active_job(busy_cells, busy_areas) if busy_cells or busy_areas else None
    missing_cells = [
        cell for cell in cells if cell_statuses.get(cell) not in DONE and (cell not in busy_cells or not active_job)
    ]
    missing_areas = [
        area_hash
        for area_hash in areas
        if area_statuses.get(area_hash) != "READY" and (area_hash not in busy_areas or not active_job)
    ]
    return missing_cells, missing_areas, cell_statuses, active_job


async def ensure_shade(area: dict, buffer_m: float, reason: str, client_hash: str | None) -> Shade:
    """Checks shade data around `area` (GeoJSON). Queues a job for what's missing; never waits."""
    if not inside_india(area):
        return Shade(status="UNAVAILABLE")  # v1 is India only: never spend Solar calls elsewhere
    cells, areas = await find_cells_and_areas(area, buffer_m)
    missing_cells, missing_areas, cell_statuses, active_job = await find_missing_work(cells, areas)
    if not missing_cells and not missing_areas:
        if active_job:
            return preparing(str(active_job["id"]), len(active_job["cells"]), active_job["cells_done"])
        if cells and all(cell_statuses[cell] == "NO_DATA" for cell in cells):
            return Shade(status="UNAVAILABLE")
        return Shade(status="READY")
    allowed = await cells_allowed(client_hash)
    if missing_cells and not allowed:
        return Shade(status="UNAVAILABLE")
    new_cells = missing_cells[:allowed]
    job_id = await queue_job(reason, client_hash, new_cells, missing_areas)
    return preparing(job_id, len(new_cells), 0)
