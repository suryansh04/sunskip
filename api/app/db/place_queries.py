import asyncpg

from app.db.pool import get_pool


async def find_named_places(
    patterns: list[str], lat: float, lng: float, radius_m: float, limit: int
) -> list[asyncpg.Record]:
    # Named OSM places and stops near the walker whose name matches any pattern, nearest first.
    # DISTINCT ON keeps one row per name: a bus stop often has a node on each side of the road.
    return await get_pool().fetch(
        """
        WITH here AS (SELECT ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography AS point),
        named AS (
            SELECT name, kind, geom FROM pois WHERE name IS NOT NULL
            UNION ALL
            SELECT name, kind, geom FROM stops
        ),
        matches AS (
            SELECT DISTINCT ON (lower(name)) name, kind, ST_Y(geom) AS lat, ST_X(geom) AS lng,
                   ST_Distance(geom::geography, here.point) AS distance_m
            FROM named, here
            WHERE name ~* ANY($1::text[]) AND ST_DWithin(geom::geography, here.point, $4)
            ORDER BY lower(name), distance_m
        )
        SELECT * FROM matches ORDER BY distance_m LIMIT $5
        """,
        patterns,
        lat,
        lng,
        radius_m,
        limit,
    )
