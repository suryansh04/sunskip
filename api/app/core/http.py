import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx

from app.config import settings
from app.db.status_queries import record_service_result

# httpx logs every URL at INFO, and Google URLs carry our key, so keep it quiet
logging.getLogger("httpx").setLevel(logging.WARNING)

# Public services like Overpass refuse requests that don't name the app
USER_AGENT = "SunSkip/1.0 (shade-aware walking routes, India)"

http_client = httpx.AsyncClient(timeout=settings.outside_call_timeout_s, headers={"User-Agent": USER_AGENT})


def describe_error(error: Exception) -> str:
    # Only the type and status: URLs can carry API keys
    if isinstance(error, httpx.HTTPStatusError):
        return f"HTTP {error.response.status_code}"
    return type(error).__name__


@asynccontextmanager
async def track_service(service: str) -> AsyncIterator[None]:
    try:
        yield
    except Exception as error:
        await record_service_result(service, describe_error(error))
        raise
    await record_service_result(service, None)


async def close_http_client() -> None:
    await http_client.aclose()
