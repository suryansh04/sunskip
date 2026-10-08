from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from app.config import settings
from app.db.pool import get_pool


@dataclass
class RequestLog:
    trip_id: UUID
    client_hash: str
    origin: tuple[float, float]  # (lng, lat)
    destination: tuple[float, float] | None
    depart_at: datetime
    preference: float
    status: str
    coverage: str | None = None
    shade_status: str | None = None
    shade_job_id: str | None = None
    option_count: int = 0
    top_option_id: str | None = None
    top_sun_minutes: float | None = None
    top_segment_ids: tuple[int, ...] = ()
    latency_ms: int | None = None


async def save_trip(trip_id: UUID, client_hash: str, request: dict, options: list[dict]) -> None:
    await get_pool().execute(
        "INSERT INTO trips (id, client_hash, request, options) VALUES ($1, $2, $3, $4)",
        trip_id,
        client_hash,
        request,
        options,
    )


async def load_trip(trip_id: UUID):
    return await get_pool().fetchrow(
        "SELECT id, request, options FROM trips WHERE id = $1 AND expires_at > now()", trip_id
    )


async def log_route_request(log: RequestLog) -> None:
    # Locations are snapped to a ~50 m grid before they are stored (privacy)
    await get_pool().execute(
        """
        INSERT INTO route_requests (id, client_hash, origin_rounded, dest_rounded, depart_at, preference, status,
            coverage, shade_status, shade_job_id, option_count, top_option_id, top_sun_minutes, top_segment_ids,
            latency_ms)
        VALUES ($1, $2, ST_SnapToGrid(ST_Point($3, $4, 4326), $18),
                CASE WHEN $5::float8 IS NULL THEN NULL ELSE ST_SnapToGrid(ST_Point($5, $6, 4326), $18) END,
                $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
        """,
        log.trip_id,
        log.client_hash,
        *log.origin,
        *(log.destination or (None, None)),
        log.depart_at,
        log.preference,
        log.status,
        log.coverage,
        log.shade_status,
        UUID(log.shade_job_id) if log.shade_job_id else None,
        log.option_count,
        log.top_option_id,
        log.top_sun_minutes,
        list(log.top_segment_ids),
        log.latency_ms,
        settings.privacy_grid_deg,
    )


async def save_choice(trip_id: UUID, option: dict) -> None:
    segment_ids = [segment_id for leg in option["legs"] for segment_id in leg.get("segmentIds", [])]
    await get_pool().execute(
        """
        INSERT INTO route_choices (trip_id, option_id, labels, sun_minutes, segment_ids) VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (trip_id) DO UPDATE
        SET option_id = EXCLUDED.option_id, labels = EXCLUDED.labels, sun_minutes = EXCLUDED.sun_minutes,
            segment_ids = EXCLUDED.segment_ids, chosen_at = now()
        """,
        trip_id,
        option["optionId"],
        option["labels"],
        option["exposure"]["sunMinutes"],
        segment_ids,
    )
