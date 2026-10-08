import asyncio
import logging

from app.config import settings
from app.db.pool import get_pool

logger = logging.getLogger(__name__)

# schema.md §6: what we keep and for how long
CLEANUP_SQL = """
DELETE FROM trips               WHERE expires_at < now();
DELETE FROM route_requests      WHERE created_at < now() - interval '30 days';
DELETE FROM agent_sessions      WHERE last_active_at < now() - interval '30 days';
DELETE FROM shade_jobs          WHERE created_at < now() - interval '7 days';
DELETE FROM google_routes_cache WHERE expires_at < now();
DELETE FROM conditions_cache    WHERE expires_at < now() - interval '1 day';
"""


async def run_cleanup_forever() -> None:
    while True:
        try:
            await get_pool().execute(CLEANUP_SQL)
        except Exception:
            logger.exception("Cleanup failed")
        await asyncio.sleep(settings.cleanup_interval_s)
