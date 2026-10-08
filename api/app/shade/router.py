import uuid

from fastapi import APIRouter, Query, Request, Response

from app.config import settings
from app.contracts.models import ShadeJob
from app.core.errors import ApiError
from app.db.shade_queries import get_job
from app.shade.segments import shade_map

READY_CACHE_SECONDS = 86400

router = APIRouter(tags=["shade"])


@router.get("/shade/segments")
async def get_shade_segments(
    request: Request,
    response: Response,
    bbox: str,
    month: int = Query(ge=1, le=12),
    hour: int = Query(ge=0, le=23),
) -> dict:
    answer, shade = await shade_map(bbox, month, hour, request.state.client_hash)
    response.headers["Cache-Control"] = (
        f"public, max-age={READY_CACHE_SECONDS}" if shade.status == "READY" else "no-store"
    )
    return answer


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
