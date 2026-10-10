import hashlib
import hmac
import uuid
from collections.abc import Awaitable, Callable

from fastapi import Request, Response

from app.config import settings
from app.core.errors import error_response

CallNext = Callable[[Request], Awaitable[Response]]
CLIENT_ID_FREE_PATHS = ("/v1/portal/", "/v1/health", "/docs", "/openapi.json")
PREFLIGHT_STATUS = 204


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
    client_id = request.headers.get("X-Client-Id")
    request.state.client_hash = hash_client_id(client_id) if client_id else None
    if not client_id and not request.url.path.startswith(CLIENT_ID_FREE_PATHS):
        return error_response(request, 400, "INVALID_REQUEST", "X-Client-Id header is required")
    return await call_next(request)


async def guard_request(request: Request, call_next: CallNext) -> Response:
    request.state.request_id = str(uuid.uuid4())
    response = await _check_then_call(request, call_next)
    response.headers["X-Request-Id"] = request.state.request_id
    return response
