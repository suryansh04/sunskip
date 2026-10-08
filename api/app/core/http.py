from contextlib import asynccontextmanager

import httpx

from app.config import settings
from app.db.status_queries import record_service_result

http_client = httpx.AsyncClient(timeout=settings.outside_call_timeout_s)


def _describe_error(error: Exception) -> str:
    # Only the type and status: URLs can carry API keys
    if isinstance(error, httpx.HTTPStatusError):
        return f"HTTP {error.response.status_code}"
    return type(error).__name__


@asynccontextmanager
async def track_service(service: str):
    try:
        yield
    except Exception as error:
        await record_service_result(service, _describe_error(error))
        raise
    await record_service_result(service, None)


async def close_http_client() -> None:
    await http_client.aclose()
