import uuid

from fastapi import APIRouter

from app.config import settings
from app.contracts.models import ShadeJob
from app.core.errors import ApiError, not_implemented
from app.db.shade_queries import get_job

router = APIRouter(tags=["shade"])


@router.get("/shade/segments")
async def get_shade_segments():
    raise not_implemented()


@router.get("/shade/jobs/{job_id}", response_model=ShadeJob)
async def get_shade_job(job_id: uuid.UUID) -> ShadeJob:
    job = await get_job(job_id)
    if job is None:
        raise ApiError(404, "NOT_FOUND", "Shade job not found or expired")
    return ShadeJob(
        job_id=str(job["id"]),
        status=job["status"],
        reason=job["reason"],
        cells_total=job["cells_total"],
        cells_done=job["cells_done"],
        cells_no_data=job["cells_no_data"],
        poll_after_seconds=settings.poll_after_seconds,
        ready_to_replan=job["status"] == "DONE",
    )
