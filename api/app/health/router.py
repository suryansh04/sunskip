import asyncio
from datetime import UTC, datetime, timedelta

import boto3
from botocore.exceptions import BotoCoreError, ClientError
from fastapi import APIRouter

from app.config import settings
from app.core.errors import ApiError
from app.db.pool import get_pool
from app.db.status_queries import get_service_statuses, get_shade_counts, get_solar_calls_this_month

WORKER_SILENT_LIMIT = timedelta(minutes=2)
QUEUED_TOO_LONG_S = 300

router = APIRouter(tags=["health"])


async def _check_db() -> None:
    try:
        await get_pool().fetchval("SELECT 1")
    except Exception as error:
        raise ApiError(503, "INTERNAL_ERROR", "Database is down") from error


def _check_s3() -> str:
    if not settings.s3_bucket:
        return "ok"
    try:
        boto3.client("s3", region_name=settings.aws_region).head_bucket(Bucket=settings.s3_bucket)
    except (BotoCoreError, ClientError):
        return "error"
    return "ok"


def _is_degraded(services: dict, worker_seen_at: datetime | None, oldest_queued_s: int) -> bool:
    now = datetime.now(UTC)
    failed_last = any(
        status["lastErrorAt"] and (not status["lastSuccessAt"] or status["lastErrorAt"] > status["lastSuccessAt"])
        for status in services.values()
    )
    worker_silent = worker_seen_at is None or now - worker_seen_at > WORKER_SILENT_LIMIT
    return failed_last or worker_silent or oldest_queued_s > QUEUED_TOO_LONG_S


@router.get("/health")
async def get_health() -> dict:
    await _check_db()
    counts = await get_shade_counts()
    rows = {row["service"]: row for row in await get_service_statuses()}
    worker_seen_at = rows.pop("worker")["last_success_at"]
    services = {
        name: {"lastSuccessAt": row["last_success_at"], "lastErrorAt": row["last_error_at"]}
        for name, row in rows.items()
    }
    degraded = _is_degraded(services, worker_seen_at, counts["oldest_queued_seconds"])
    return {
        "status": "degraded" if degraded else "ok",
        "db": "ok",
        "s3": await asyncio.to_thread(_check_s3),
        "shade": {
            "cellsReady": counts["cells_ready"],
            "cellsNoData": counts["cells_no_data"],
            "jobsQueued": counts["jobs_queued"],
            "oldestQueuedSeconds": counts["oldest_queued_seconds"],
            "solarCallsThisMonth": await get_solar_calls_this_month(),
            "solarBudget": settings.solar_monthly_call_budget,
            "workerLastSeenAt": worker_seen_at,
        },
        "services": services,
    }
