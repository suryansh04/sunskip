import json

from app.db.pool import get_pool


async def load_corridor_segments(line: dict, buffer_m: float, month: int):
    """Shade-ready segments near a walk, one row per (segment, hour with shade data)."""
    return await get_pool().fetch(
        """
        SELECT s.id, s.from_node, s.to_node, s.length_m, s.name, ST_AsGeoJSON(s.geom)::json AS geometry,
               sh.hour, sh.sun_fraction, sh.nodata_fraction
        FROM segments s
        LEFT JOIN segment_shade sh ON sh.segment_id = s.id AND sh.month = $3
        WHERE s.shade_ready
          AND ST_Intersects(s.geom, ST_Buffer(ST_GeomFromGeoJSON($1)::geography, $2)::geometry)
        """,
        json.dumps(line),
        buffer_m,
        month,
    )


async def find_stop_shade(lng: float, lat: float, month: int, hour: int, max_m: float):
    """Our nearest stop within max_m of Google's stop, with its shade at that hour (None if no match)."""
    return await get_pool().fetchrow(
        """
        SELECT st.id, COALESCE(st.has_shelter OR ss.sun_fraction < 0.5, st.has_shelter) AS shaded, ss.sun_fraction
        FROM stops st
        LEFT JOIN stop_shade ss ON ss.stop_id = st.id AND ss.month = $3 AND ss.hour = $4
        WHERE ST_DWithin(st.geom::geography, ST_Point($1, $2, 4326)::geography, $5)
        ORDER BY st.geom <-> ST_Point($1, $2, 4326)
        LIMIT 1
        """,
        lng,
        lat,
        month,
        hour,
        max_m,
    )


async def find_erickshaw_zone(start: tuple[float, float], end: tuple[float, float]):
    """An active zone that holds both ends of a walk, or None."""
    return await get_pool().fetchrow(
        """
        SELECT name, base_fare_inr, per_km_inr FROM erickshaw_zones
        WHERE active AND ST_Contains(geom, ST_Point($1, $2, 4326)) AND ST_Contains(geom, ST_Point($3, $4, 4326))
        LIMIT 1
        """,
        *start,
        *end,
    )


async def load_segments(segment_ids: list[int]):
    return await get_pool().fetch(
        "SELECT id, name, length_m, ST_AsGeoJSON(geom)::json AS geometry FROM segments WHERE id = ANY($1)",
        segment_ids,
    )
