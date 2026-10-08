import json

import asyncpg

from app.config import settings

_pool: asyncpg.Pool | None = None


async def _use_json_codecs(connection: asyncpg.Connection) -> None:
    for type_name in ("json", "jsonb"):
        await connection.set_type_codec(type_name, encoder=json.dumps, decoder=json.loads, schema="pg_catalog")


async def open_pool(max_size: int) -> None:
    global _pool
    _pool = await asyncpg.create_pool(settings.database_url, min_size=1, max_size=max_size, init=_use_json_codecs)


async def close_pool() -> None:
    if _pool:
        await _pool.close()


def get_pool() -> asyncpg.Pool:
    return _pool
