import json
from datetime import datetime

import asyncpg

from app.db.pool import get_pool

TOP_ORIGINS = 10


async def load_stats(start: datetime, end: datetime) -> asyncpg.Record | None:
    return await get_pool().fetchrow(
        """
        SELECT count(*) AS requests,
               count(*) FILTER (WHERE r.status = 'OK') AS ok_requests,
               count(c.trip_id) AS choices,
               avg(r.top_sun_minutes) FILTER (WHERE r.status = 'OK') AS avg_sun_minutes
        FROM route_requests r LEFT JOIN route_choices c ON c.trip_id = r.id
        WHERE r.created_at >= $1 AND r.created_at < $2
        """,
        start,
        end,
    )


async def load_top_origins(start: datetime, end: datetime) -> list[asyncpg.Record]:
    return await get_pool().fetch(
        """
        SELECT ST_Y(origin_rounded) AS lat, ST_X(origin_rounded) AS lng, count(*) AS count
        FROM route_requests WHERE created_at >= $1 AND created_at < $2
        GROUP BY origin_rounded ORDER BY count DESC LIMIT $3
        """,
        start,
        end,
        TOP_ORIGINS,
    )


# Pain = walkers x sun share x length, per stretch, scaled so the worst one in the area is 100.
# Demand is a LEFT JOIN: a fresh area has no estimates until the nightly job runs.
HEAT_PAIN_SQL = """
WITH seg AS (
  SELECT s.stretch_id, s.length_m,
         COALESCE(d.walkers_per_day, 0) AS walkers, COALESCE(d.app_trips_30d, 0) AS app_trips,
         COALESCE(avg(sh.sun_fraction) FILTER (WHERE sh.nodata_fraction < 1), 0) AS sun
  FROM segments s
  LEFT JOIN demand_estimates d ON d.segment_id = s.id
  LEFT JOIN segment_shade sh ON sh.segment_id = s.id AND sh.month = $5 AND sh.hour BETWEEN $6 AND $7
  WHERE s.shade_ready AND s.stretch_id IS NOT NULL AND s.geom && ST_MakeEnvelope($1, $2, $3, $4, 4326)
  GROUP BY s.id, d.walkers_per_day, d.app_trips_30d
), st AS (
  SELECT stretch_id,
         sum(walkers * length_m) / sum(length_m) AS walkers_per_day,
         sum(app_trips * length_m) / sum(length_m) AS app_trips_30d,
         sum(sun * length_m) / sum(length_m) AS sun_share,
         sum(length_m) AS length_m
  FROM seg GROUP BY stretch_id
)
SELECT st.*, stretches.name, ST_AsGeoJSON(stretches.geom)::json AS geometry,
       100 * walkers_per_day * sun_share * st.length_m
         / NULLIF(max(walkers_per_day * sun_share * st.length_m) OVER (), 0) AS pain_score
FROM st JOIN stretches ON stretches.id = st.stretch_id
ORDER BY pain_score DESC NULLS LAST, st.length_m DESC
LIMIT $8
"""


async def load_heat_pain(bbox: tuple, month: int, hours: tuple[int, int], limit: int) -> list[asyncpg.Record]:
    return await get_pool().fetch(HEAT_PAIN_SQL, *bbox, month, *hours, limit)


async def load_stretch(stretch_id: int) -> asyncpg.Record | None:
    return await get_pool().fetchrow(
        """
        SELECT st.id, st.name, st.length_m, array_agg(s.id ORDER BY s.id) AS segment_ids,
               sum(COALESCE(d.poi_walkers_per_day, 0) * s.length_m) / sum(s.length_m) AS poi_walkers,
               sum(COALESCE(d.app_trips_30d, 0) * s.length_m) / sum(s.length_m) AS app_trips_30d,
               sum(COALESCE(d.walkers_per_day, 0) * s.length_m) / sum(s.length_m) AS walkers_per_day
        FROM stretches st
        JOIN segments s ON s.stretch_id = st.id
        LEFT JOIN demand_estimates d ON d.segment_id = s.id
        WHERE st.id = $1
        GROUP BY st.id
        """,
        stretch_id,
    )


async def load_stretch_sun(stretch_id: int) -> list[asyncpg.Record]:
    """Length-weighted sun share for every month and hour with data (sun >= 5° up and not all no-data)."""
    return await get_pool().fetch(
        """
        SELECT sh.month, sh.hour, sum(sh.sun_fraction * s.length_m) / sum(s.length_m) AS sun
        FROM segments s JOIN segment_shade sh ON sh.segment_id = s.id
        WHERE s.stretch_id = $1 AND sh.nodata_fraction < 1
        GROUP BY sh.month, sh.hour
        """,
        stretch_id,
    )


async def load_segments_near(points: list[tuple[float, float]], reach_m: float) -> list[asyncpg.Record]:
    """Shade-ready segments within reach of any of these points, with their walkers per day."""
    # The && box check lets the geometry index skip far-away segments before the exact distance check
    return await get_pool().fetch(
        """
        WITH area AS (SELECT ST_Envelope(ST_Buffer(ST_GeomFromGeoJSON($1)::geography, $2)::geometry) AS box)
        SELECT s.id, s.length_m, ST_AsGeoJSON(s.geom)::json AS geometry, COALESCE(d.walkers_per_day, 0) AS walkers
        FROM segments s LEFT JOIN demand_estimates d ON d.segment_id = s.id
        WHERE s.shade_ready AND s.geom && (SELECT box FROM area)
          AND ST_DWithin(s.geom::geography, ST_GeomFromGeoJSON($1)::geography, $2)
        """,
        json.dumps({"type": "MultiPoint", "coordinates": points}),
        reach_m,
    )


async def load_stretch_segments(stretch_ids: list[int]) -> list[asyncpg.Record]:
    return await get_pool().fetch(
        "SELECT id, stretch_id, ST_AsGeoJSON(geom)::json AS geometry FROM segments WHERE stretch_id = ANY($1)",
        stretch_ids,
    )


async def load_stops_near_stretches(stretch_ids: list[int], max_m: float) -> list[asyncpg.Record]:
    return await get_pool().fetch(
        """
        SELECT DISTINCT ON (st.id) st.id AS stretch_id, ST_X(stop.geom) AS lng, ST_Y(stop.geom) AS lat
        FROM stretches st JOIN stops stop
          ON stop.geom && ST_Envelope(ST_Buffer(st.geom::geography, $2)::geometry)
         AND ST_DWithin(stop.geom::geography, st.geom::geography, $2)
        WHERE st.id = ANY($1)
        ORDER BY st.id, stop.geom <-> st.geom
        """,
        stretch_ids,
        max_m,
    )


# For each stretch with no OSM name: its main kind of way, and the nearest named places and roads
# at the label distances. The && box (metres / 90,000 is a little over that many degrees in India) lets the GiST
# index pick the few candidates; ST_DWithin on geography then checks the real distance in metres.
STRETCH_LABEL_SQL = """
WITH unnamed AS (SELECT id, geom FROM stretches WHERE id = ANY($1::int[]) AND name IS NULL),
main_way AS (
  SELECT DISTINCT ON (s.stretch_id) s.stretch_id, s.highway
  FROM segments s JOIN unnamed u ON u.id = s.stretch_id
  GROUP BY s.stretch_id, s.highway
  ORDER BY s.stretch_id, sum(s.length_m) DESC
)
SELECT u.id, w.highway,
  (SELECT p.name FROM pois p WHERE p.name IS NOT NULL AND p.geom && ST_Expand(u.geom, $2 / 90000.0)
     AND ST_DWithin(p.geom::geography, u.geom::geography, $2)
   ORDER BY p.geom <-> u.geom LIMIT 1) AS by_place,
  (SELECT s.name FROM segments s WHERE s.name IS NOT NULL AND s.stretch_id IS DISTINCT FROM u.id
     AND s.geom && ST_Expand(u.geom, $3 / 90000.0) AND ST_DWithin(s.geom::geography, u.geom::geography, $3)
   ORDER BY s.geom <-> u.geom LIMIT 1) AS off_road,
  (SELECT s.name FROM segments s WHERE s.name IS NOT NULL AND s.stretch_id IS DISTINCT FROM u.id
     AND s.geom && ST_Expand(u.geom, $4 / 90000.0) AND ST_DWithin(s.geom::geography, u.geom::geography, $4)
   ORDER BY s.geom <-> u.geom LIMIT 1) AS near_road,
  (SELECT p.name FROM pois p WHERE p.name IS NOT NULL AND p.geom && ST_Expand(u.geom, $5 / 90000.0)
     AND ST_DWithin(p.geom::geography, u.geom::geography, $5)
   ORDER BY p.geom <-> u.geom LIMIT 1) AS near_place
FROM unnamed u JOIN main_way w ON w.stretch_id = u.id
"""


async def load_stretch_label_parts(
    stretch_ids: list[int], place_m: float, join_m: float, road_m: float, area_m: float
) -> list[asyncpg.Record]:
    return await get_pool().fetch(STRETCH_LABEL_SQL, stretch_ids, place_m, join_m, road_m, area_m)
