import hashlib
import hmac
import logging
import uuid
from collections.abc import Awaitable, Callable

from fastapi import Request, Response

from app.config import settings
from app.core.caps import MinuteLimit
from app.core.errors import error_response

CallNext = Callable[[Request], Awaitable[Response]]
CLIENT_ID_FREE_PATHS = ("/v1/portal/", "/v1/health", "/docs", "/openapi.json")
UNLIMITED_PATHS = ("/v1/health",)
PREFLIGHT_STATUS = 204

logger = logging.getLogger(__name__)
per_ip = MinuteLimit(settings.requests_per_ip_per_minute)


def client_ip(request: Request) -> str:
    """The caller's address. API Gateway puts it first in X-Forwarded-For; only trust that header when the
    origin secret proves the request came through the gateway."""
    forwarded = request.headers.get("X-Forwarded-For", "")
    if forwarded and settings.origin_secret_check:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def hash_client_id(client_id: str) -> str:
    return hmac.new(settings.client_id_salt.encode(), client_id.encode(), hashlib.sha256).hexdigest()


def _has_origin_secret(request: Request) -> bool:
    if not settings.origin_secret:
        return False  # check on but no secret set: refuse everything rather than let everyone in
    sent_secret = request.headers.get("X-Origin-Secret", "")
    return hmac.compare_digest(sent_secret, settings.origin_secret)


async def _check_then_call(request: Request, call_next: CallNext) -> Response:
    if settings.origin_secret_check and not _has_origin_secret(request):
        return error_response(request, 403, "FORBIDDEN", "No access")
    # The gateway's ANY route sends browsers' CORS pre-checks here too. They carry no X-Client-Id;
    # answer them empty and the gateway adds its CORS headers
    if request.method == "OPTIONS":
        return Response(status_code=PREFLIGHT_STATUS)
    request.state.client_ip = client_ip(request)
    if not request.url.path.startswith(UNLIMITED_PATHS) and not per_ip.allow(request.state.client_ip):
        return error_response(request, 429, "RATE_LIMITED", "Too many requests. Try again in a minute")
    client_id = request.headers.get("X-Client-Id")
    request.state.client_hash = hash_client_id(client_id) if client_id else None
    if not client_id and not request.url.path.startswith(CLIENT_ID_FREE_PATHS):
        return error_response(request, 400, "INVALID_REQUEST", "X-Client-Id header is required")
    return await call_next(request)


async def guard_request(request: Request, call_next: CallNext) -> Response:
    request.state.request_id = str(uuid.uuid4())
    try:
        response = await _check_then_call(request, call_next)
    except Exception:
        # Answer in our error shape, with the request ID, so a 500 can be found in the logs
        logger.exception("Unhandled error on %s %s (%s)", request.method, request.url.path, request.state.request_id)
        response = error_response(request, 500, "INTERNAL_ERROR", "Something went wrong on our side")
    response.headers["X-Request-Id"] = request.state.request_id
    return response
