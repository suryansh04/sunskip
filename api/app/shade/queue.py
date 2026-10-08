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
DONE = {"READY", "NO_DATA"}


def preparing(job_id: str, cells_total: int, cells_done: int) -> Shade:
    return Shade(
        status="PREPARING",
        job_id=job_id,
        cells_total=cells_total,
        cells_done=cells_done,
        poll_after_seconds=settings.poll_after_seconds,
    )


async def can_queue(client_hash: str | None, new_cells: int) -> bool:
    if await get_solar_calls_this_month() >= settings.solar_monthly_call_budget:
        return False
    if client_hash is None:
        return True
    already_today = await count_client_cells_today(client_hash)
    return already_today + new_cells <= settings.max_new_cells_per_client_per_day


def points_of(coordinates: list) -> list[list[float]]:
    """Every [lng, lat] in any GeoJSON geometry's (nested) coordinates."""
    if coordinates and isinstance(coordinates[0], int | float):
        return [coordinates]
    return [point for part in coordinates for point in points_of(part)]


def inside_india(area: dict) -> bool:
    west, south, east, north = INDIA_BBOX
    return all(west <= lng <= east and south <= lat <= north for lng, lat in points_of(area["coordinates"]))


async def ensure_shade(area: dict, buffer_m: float, reason: str, client_hash: str | None) -> Shade:
    """Checks shade data around `area` (GeoJSON). Queues a job for what's missing; never waits."""
    if not inside_india(area):
        return Shade(status="UNAVAILABLE")  # v1 is India only: never spend Solar calls elsewhere
    cells, areas = await find_cells_and_areas(area, buffer_m)
    cell_statuses = await get_cell_statuses(cells)
    in_progress = [cell for cell in cells if cell_statuses.get(cell) in IN_PROGRESS]
    active_job = await find_active_job(in_progress) if in_progress else None
    # Cells stuck in progress without a live job (its job failed) get queued again
    missing = [
        cell for cell in cells if cell_statuses.get(cell) not in DONE and (cell not in in_progress or not active_job)
    ]
    area_statuses = await get_area_statuses(areas)
    missing_areas = [area_hash for area_hash in areas if area_statuses.get(area_hash, "ERROR") == "ERROR"]

    if not missing and not missing_areas:
        if active_job:
            return preparing(str(active_job["id"]), len(active_job["cells"]), active_job["cells_done"])
        if cells and all(cell_statuses[cell] == "NO_DATA" for cell in cells):
            return Shade(status="UNAVAILABLE")
        return Shade(status="READY")

    new_cells = missing[: settings.max_cells_per_job]
    if not await can_queue(client_hash, len(new_cells)):
        return Shade(status="UNAVAILABLE")
    job_id = await queue_job(reason, client_hash, new_cells, missing_areas)
    return preparing(job_id, len(new_cells), 0)
