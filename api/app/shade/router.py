import uuid

from fastapi import APIRouter, Query, Request, Response

from app.config import settings
from app.contracts.models import ShadeJob
from app.core.errors import ApiError
from app.core.formulas import round_half_up, round_whole
from app.db.shade_queries import get_job, load_shade_map
from app.shade.bbox import bbox_polygon, parse_bbox
from app.shade.queue import ensure_shade

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
    box = parse_bbox(bbox, settings.max_shade_map_km2)
    shade = await ensure_shade(bbox_polygon(box), 0, "MAP", request.state.client_hash)
    response.headers["Cache-Control"] = (
        f"public, max-age={READY_CACHE_SECONDS}" if shade.status == "READY" else "no-store"
    )
    features = [
        {
            "type": "Feature",
            "properties": {
                "id": f"seg_{row['id']}",
                "sunFraction": round_half_up(row["sun_fraction"], 2),
                "lengthM": round_whole(row["length_m"]),
                "stretchId": f"str_{row['stretch_id']:03d}" if row["stretch_id"] else None,
            },
            "geometry": row["geometry"],
        }
        for row in await load_shade_map(box, month, hour)
    ]
    shade_json = shade.model_dump(mode="json", by_alias=True)
    return {"month": month, "hour": hour, "shade": shade_json, "type": "FeatureCollection", "features": features}


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
