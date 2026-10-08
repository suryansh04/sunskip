from app.db.pool import get_pool

# poi walkers = sum of weight x exp(-distance / decay) for places within the radius;
# app trips = trips in the last 30 days that used the segment (chosen option, else the top one)
DEMAND_SQL = """
WITH poi AS (
  SELECT s.id AS segment_id,
         COALESCE(sum(p.weight * exp(-ST_Distance(s.geom::geography, p.geom::geography) / $1)), 0) AS walkers
  FROM segments s
  LEFT JOIN pois p ON ST_DWithin(s.geom::geography, p.geom::geography, $2)
  WHERE s.shade_ready
  GROUP BY s.id
), app AS (
  SELECT seg_id, count(*) AS trips
  FROM (SELECT unnest(COALESCE(c.segment_ids, r.top_segment_ids)) AS seg_id
        FROM route_requests r LEFT JOIN route_choices c ON c.trip_id = r.id
        WHERE r.status = 'OK' AND r.created_at > now() - make_interval(days => $3)) used
  GROUP BY seg_id
)
INSERT INTO demand_estimates (segment_id, poi_walkers_per_day, app_trips_30d, walkers_per_day, computed_at)
SELECT poi.segment_id, poi.walkers, COALESCE(app.trips, 0), poi.walkers + COALESCE(app.trips, 0)::float8 / $3, now()
FROM poi LEFT JOIN app ON app.seg_id = poi.segment_id
ON CONFLICT (segment_id) DO UPDATE
SET poi_walkers_per_day = EXCLUDED.poi_walkers_per_day, app_trips_30d = EXCLUDED.app_trips_30d,
    walkers_per_day = EXCLUDED.walkers_per_day, computed_at = EXCLUDED.computed_at
"""
APP_TRIPS_DAYS = 30  # the column is app_trips_30d


async def update_demand(decay_m: float, radius_m: float) -> None:
    await get_pool().execute(DEMAND_SQL, decay_m, radius_m, APP_TRIPS_DAYS)


async def count_demand_estimates() -> int:
    return await get_pool().fetchval("SELECT count(*) FROM demand_estimates")
