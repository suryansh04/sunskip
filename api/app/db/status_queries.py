from app.db.pool import get_pool

THIS_MONTH_IST = "date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata')::date"


async def record_service_result(service: str, error: str | None) -> None:
    if error is None:
        await get_pool().execute("UPDATE service_status SET last_success_at = now() WHERE service = $1", service)
        return
    await get_pool().execute(
        "UPDATE service_status SET last_error_at = now(), last_error = $2 WHERE service = $1",
        service,
        error,
    )


async def record_worker_heartbeat() -> None:
    await record_service_result("worker", None)


async def get_imagery_dates():
    return await get_pool().fetchrow(
        "SELECT min(imagery_date) AS min_date, max(imagery_date) AS max_date FROM shade_cells WHERE status = 'READY'"
    )


async def get_solar_calls_this_month() -> int:
    calls = await get_pool().fetchval(f"SELECT calls FROM solar_usage WHERE month_start = {THIS_MONTH_IST}")
    return calls or 0


async def get_shade_counts():
    return await get_pool().fetchrow(
        """
        SELECT (SELECT count(*) FROM shade_cells WHERE status = 'READY')   AS cells_ready,
               (SELECT count(*) FROM shade_cells WHERE status = 'NO_DATA') AS cells_no_data,
               (SELECT count(*) FROM shade_jobs WHERE status = 'QUEUED')   AS jobs_queued,
               (SELECT COALESCE(EXTRACT(EPOCH FROM now() - min(created_at)), 0)::int
                  FROM shade_jobs WHERE status = 'QUEUED')                 AS oldest_queued_seconds
        """
    )


async def get_service_statuses():
    return await get_pool().fetch("SELECT service, last_success_at, last_error_at FROM service_status")
