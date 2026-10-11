import asyncpg

from app.db.pool import get_pool

APP_TRIPS_DAYS = 30  # the column is app_trips_30d


async def load_walk_graph() -> list[asyncpg.Record]:
    return await get_pool().fetch("SELECT id, from_node, to_node, length_m FROM segments")


# Each place and stop joins the network at the nearer end of its nearest path
TRIP_PLACES_SQL = """
WITH places AS (
  SELECT kind, geom FROM pois
  UNION ALL
  SELECT kind, geom FROM stops
)
SELECT places.kind, near.node
FROM places
CROSS JOIN LATERAL (
  SELECT CASE WHEN ST_Distance(ST_StartPoint(s.geom), places.geom) <= ST_Distance(ST_EndPoint(s.geom), places.geom)
              THEN s.from_node ELSE s.to_node END AS node
  FROM segments s
  WHERE ST_DWithin(s.geom::geography, places.geom::geography, $1)
  ORDER BY s.geom <-> places.geom
  LIMIT 1
) near
"""


async def load_trip_places(snap_m: float) -> list[asyncpg.Record]:
    return await get_pool().fetch(TRIP_PLACES_SQL, snap_m)


# Modelled walkers per segment come in as two arrays; app trips = trips in the last 30 days that used the segment
# (the chosen option, else the top one), added on top as trips a day
SAVE_DEMAND_SQL = """
WITH modelled AS (
  SELECT * FROM unnest($1::int[], $2::float8[]) AS m(segment_id, walkers)
), app AS (
  SELECT seg_id, count(*) AS trips
  FROM (SELECT unnest(COALESCE(c.segment_ids, r.top_segment_ids)) AS seg_id
        FROM route_requests r LEFT JOIN route_choices c ON c.trip_id = r.id
        WHERE r.status = 'OK' AND r.created_at > now() - make_interval(days => $3)) used
  GROUP BY seg_id
)
INSERT INTO demand_estimates (segment_id, poi_walkers_per_day, app_trips_30d, walkers_per_day, computed_at)
SELECT m.segment_id, m.walkers, COALESCE(app.trips, 0), m.walkers + COALESCE(app.trips, 0)::float8 / $3, now()
FROM modelled m LEFT JOIN app ON app.seg_id = m.segment_id
ON CONFLICT (segment_id) DO UPDATE
SET poi_walkers_per_day = EXCLUDED.poi_walkers_per_day, app_trips_30d = EXCLUDED.app_trips_30d,
    walkers_per_day = EXCLUDED.walkers_per_day, computed_at = EXCLUDED.computed_at
"""


async def save_demand(walkers_by_segment: dict[int, float]) -> None:
    segment_ids = list(walkers_by_segment)
    walkers = [walkers_by_segment[segment_id] for segment_id in segment_ids]
    await get_pool().execute(SAVE_DEMAND_SQL, segment_ids, walkers, APP_TRIPS_DAYS)


async def count_demand_estimates() -> int:
    return await get_pool().fetchval("SELECT count(*) FROM demand_estimates")
