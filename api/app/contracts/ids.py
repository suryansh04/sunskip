"""The public ids the API shows for our database rows (api.md): seg_412, str_007."""

from app.core.errors import ApiError

SEGMENT_PREFIX = "seg_"
STRETCH_PREFIX = "str_"
MAX_DB_ID = 2**31 - 1  # Postgres integer


def segment_code(segment_id: int) -> str:
    return f"{SEGMENT_PREFIX}{segment_id}"


def stretch_code(stretch_id: int | None) -> str | None:
    return None if stretch_id is None else f"{STRETCH_PREFIX}{stretch_id:03d}"


def stretch_number(code: str) -> int:
    number = code.removeprefix(STRETCH_PREFIX)
    if not code.startswith(STRETCH_PREFIX) or not number.isdigit() or int(number) > MAX_DB_ID:
        raise ApiError(404, "NOT_FOUND", "Unknown stretch")
    return int(number)
