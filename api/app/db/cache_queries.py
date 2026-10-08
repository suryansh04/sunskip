from app.db.pool import get_pool

STALE_LIMIT = "interval '24 hours'"


def conditions_cell_id(lat: float, lng: float) -> str:
    return f"{lat:.2f}:{lng:.2f}"


async def read_conditions_cache(cell_id: str, kind: str, allow_expired: bool) -> dict | None:
    freshness = f"fetched_at > now() - {STALE_LIMIT}" if allow_expired else "expires_at > now()"
    return await get_pool().fetchval(
        f"SELECT payload FROM conditions_cache WHERE cell_id = $1 AND kind = $2 AND {freshness}",
        cell_id,
        kind,
    )


async def read_routes_cache(cache_key: str) -> dict | None:
    return await get_pool().fetchval(
        "SELECT response FROM google_routes_cache WHERE cache_key = $1 AND expires_at > now()", cache_key
    )


async def write_routes_cache(cache_key: str, response: dict) -> None:
    await get_pool().execute(
        """
        INSERT INTO google_routes_cache (cache_key, response) VALUES ($1, $2)
        ON CONFLICT (cache_key) DO UPDATE
        SET response = EXCLUDED.response, created_at = now(), expires_at = now() + interval '24 hours'
        """,
        cache_key,
        response,
    )


async def write_conditions_cache(cell_id: str, kind: str, payload: dict, source: str, ttl_minutes: int) -> None:
    await get_pool().execute(
        """
        INSERT INTO conditions_cache (cell_id, kind, payload, source, fetched_at, expires_at)
        VALUES ($1, $2, $3, $4, now(), now() + make_interval(mins => $5))
        ON CONFLICT (cell_id, kind) DO UPDATE
        SET payload = EXCLUDED.payload, source = EXCLUDED.source,
            fetched_at = EXCLUDED.fetched_at, expires_at = EXCLUDED.expires_at
        """,
        cell_id,
        kind,
        payload,
        source,
        ttl_minutes,
    )
