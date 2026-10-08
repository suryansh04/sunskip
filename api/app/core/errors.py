import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException

logger = logging.getLogger(__name__)


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str, extra: dict | None = None) -> None:
        self.status = status
        self.code = code
        self.message = message
        self.extra = extra or {}


def not_implemented() -> ApiError:
    return ApiError(501, "NOT_IMPLEMENTED", "This endpoint is not built yet")


def error_response(request: Request, status: int, code: str, message: str, extra: dict | None = None) -> JSONResponse:
    request_id = getattr(request.state, "request_id", None)
    body = {"error": {"code": code, "message": message, "requestId": request_id, **(extra or {})}}
    return JSONResponse(body, status_code=status)


async def _handle_api_error(request: Request, error: ApiError) -> JSONResponse:
    return error_response(request, error.status, error.code, error.message, error.extra)


async def _handle_validation_error(request: Request, error: RequestValidationError) -> JSONResponse:
    first = error.errors()[0]
    field = ".".join(str(part) for part in first["loc"][1:])
    message = f"{field}: {first['msg']}" if field else first["msg"]  # whole-body checks have no field
    return error_response(request, 400, "INVALID_REQUEST", message)


async def _handle_http_error(request: Request, error: HTTPException) -> JSONResponse:
    code = "NOT_FOUND" if error.status_code == 404 else "INVALID_REQUEST"
    return error_response(request, error.status_code, code, str(error.detail))


async def _handle_unexpected_error(request: Request, error: Exception) -> JSONResponse:
    logger.exception("Unhandled error")
    return error_response(request, 500, "INTERNAL_ERROR", "Something went wrong on our side")


def add_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(ApiError, _handle_api_error)
    app.add_exception_handler(RequestValidationError, _handle_validation_error)
    app.add_exception_handler(HTTPException, _handle_http_error)
    app.add_exception_handler(Exception, _handle_unexpected_error)
