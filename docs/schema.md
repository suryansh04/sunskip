# SunSkip Database (v1)

> **SunSkip: Skip the sun, not the trip.**
>
> - **What this file holds:** every table, column and rule. Read it with `api.md`.
> - **Tested:** the SQL in §9 runs on PostgreSQL 16.15 + PostGIS 3.4.2, and every query in §10 returned the expected result.

---

## 1. Basics

- **Database:** Amazon RDS PostgreSQL 16 + PostGIS 3.4. One database: `sunskip`.
- **Code:**
  - `asyncpg` with plain SQL (no ORM).
  - Migrations are plain SQL files in `api/migrations/`, applied by `python -m scripts.migrate`. §9 is `0001_init.sql`.
  - **Only P1 writes migrations.**
- **Two processes use it:**
  - the **api** (FastAPI);
  - the **worker**, which fetches shade data in the background.
- **No Redis, no SQS.** Caches and the job queue are Postgres tables.
- **No ground-truth tables.** We rely on Google's shade data; we don't collect field checks in v1.
- **No user accounts for the app.** A device id is stored only as `client_hash` (HMAC). Portal logins live in Cognito.

**Rules**

- All shapes are `EPSG:4326` (lng/lat). Metres are stored in `length_m`, worked out with `::geography`.
- All times are `timestamptz` (UTC). Shade hours are **IST hours 0 to 23**, the same as Solar's bands.
- Status columns are `text` + `CHECK`, not `ENUM`, because CHECK constraints are easier to change in a migration.
- **Nearest search:** `ORDER BY geom <-> point LIMIT 5`, then exact metres with `ST_Distance(::geography)`.
- **Map cells** use PostGIS built-ins: `ST_GeoHash(geom, 7)` and `ST_Box2dFromGeoHash(hash)`.

---

## 2. Tables

| Group                 | Table                              | What it holds                                                          | Kept                     |
| --------------------- | ---------------------------------- | ---------------------------------------------------------------------- | ------------------------ |
| **Shade (on demand)** | `shade_cells`                      | One row per ~150 m map cell: status + where its Solar files are        | forever                  |
|                       | `osm_areas`                        | One row per ~1.2 × 0.6 km area whose OSM walkways and stops are loaded | forever                  |
|                       | `shade_jobs`                       | Work queue for the worker                                              | 7 days                   |
|                       | `solar_usage`                      | Solar calls per month (cost guard)                                     | forever                  |
| **Walk graph**        | `graph_nodes`                      | Path junctions and points                                              | forever                  |
|                       | `segments`                         | Walkable pieces (max 50 m)                                             | forever                  |
|                       | `segment_shade`                    | Sun share per segment, month and hour                                  | forever                  |
|                       | `stretches`                        | Joined segments that officials see                                     | forever                  |
| **Stops and demand**  | `stops`, `stop_shade`              | Bus/metro stops and their shade                                        | forever                  |
|                       | `erickshaw_zones`                  | Hand-drawn areas where e-rickshaws run, with fares                     | forever                  |
|                       | `pois`                             | Places that create walkers (from OSM)                                  | forever                  |
|                       | `demand_estimates`                 | Walkers per segment                                                    | rewritten nightly        |
| **Trips and logs**    | `trips`                            | Live trips (exact points)                                              | **30 min**               |
|                       | `route_requests`, `route_choices`  | Request log (rounded ~50 m) and chosen option                          | **30 days**              |
| **Agent**             | `agent_sessions`, `agent_messages` | Chat history                                                           | **30 days idle**         |
| **Caches**            | `google_routes_cache`              | Google route answers                                                   | 24 h                     |
|                       | `conditions_cache`                 | Weather and air quality                                                | 15 min (archive 30 days) |
|                       | `service_status`                   | Last success/error per outside service                                 | forever                  |

Audio isn't stored in the database. It lives in S3 at `audio/{sha256(text|language|voice)}.mp3`.

---

## 3. How a new area gets shade data

1. **Plan finds what's missing.**
   - `/routes/plan` buffers each walk by 100 m and lists the map cells (geohash-7) and OSM areas (geohash-6) it touches.
   - Missing ones are inserted as `PENDING`, and **one** `shade_jobs` row is created.
   - The API returns at once with `PREPARING`.
2. **The worker takes the job** with `FOR UPDATE SKIP LOCKED`.
3. **OSM first.** One Overpass query per area loads walkways, stops and places into `graph_nodes`, `segments`, `stops` and `pois`. Only one Overpass call runs at a time; on a 429 or 406 it waits 30 s and retries (the public server's policy; we stay far under its 10,000 calls/day).
4. **Then cells, 4 at a time.** For each cell:
   - check the monthly budget in `solar_usage`;
   - call Solar `dataLayers:get` at the cell centre (radius 100 m);
   - save all 12 monthly files to S3 (and a local cache), pacing downloads under Google's 180-a-minute limit;
   - set the status to `READY`.
   - A Solar 404 gives `NO_DATA`. Over budget gives `BUDGET_EXCEEDED`. 3 failures give `ERROR`.
5. **Score.** Fill `segment_shade` / `stop_shade` for every segment and stop that is now fully covered, set `segments.shade_ready = true`, and rebuild stretches for that area.
6. **Finish.** The job becomes `DONE`. The app sees this and re-plans.

**Sizes (tested in our DB):**

- **One cell** is ~152 m north-south × ~136 m east-west in Jaipur. A 200 × 200 m Solar tile covers it with room to spare.
- **A walk corridor:** a straight 570 m corridor at MUJ touches **12 cells** with a 100 m buffer (21 with 150 m). An 800 m walk should need about 12 to 20 Solar calls (estimate).

**Safety:**

- **Cost:**
  - max 120 cells per job;
  - max 60 new cells per client per day (a request queues what's left of that, the rest waits for the next day);
  - stop at 6,500 Solar calls a month (Google's free tier for India is 7,000).
- **Crash recovery:** only one worker runs, so when it starts, any job left `RUNNING` goes back to `QUEUED` and any cell or OSM area left `FETCHING` goes back to `PENDING`. (A time limit would wrongly requeue a big preload job that's still running.)
- **Failed jobs:** cells a failed job left `FETCHING` go back to `PENDING`. Any cell or OSM area that's not done and has no live job is queued again by the next request that needs it.
- **No duplicates:** every write is an upsert on a unique key, so retries are safe.

---

## 4. Key rules per table

**`segments`**

- OSM ways are split at junctions, and again so no piece is over 50 m.
- **Split points** get negative ids: `-(hash(way_id, index) >> 1)`.
- **`(osm_way_id, way_seq)` is unique,** so reloading an area changes nothing.
- **`shade_ready`** is true when every 5 m sample point falls in a `READY` or `NO_DATA` cell.

**`segment_shade`**

- **How a value is made:**
  - sample every 5 m;
  - read the Solar bit for **day 15** of the month at that hour (**set bit = sun**);
  - `sun_fraction` = sun points ÷ points with data;
  - `nodata_fraction` = points without data ÷ all points.
- **Rows exist only when the sun is ≥ 5° up** (pvlib). Read with `COALESCE(sun_fraction, 0)`.
- **If `nodata_fraction = 1`,** the shade is unknown, not shade.
- **Real check:** the MUJ Bus 26 walk must read ~1.0 for May, hours 10 to 13.

**`stretches`**

- Neighbouring segments join into one stretch when the node between them has exactly 2 segments in the whole walk graph and their May 10:00 to 16:00 sun differs by less than 0.2.
- A rebuild covers the job's cells plus every other segment of any stretch it touches, so no segment is left without a stretch.
- **Real example:** the ~430 m GHS footpath.

**`stops` / `stop_shade`**

- **Stops come from OSM:** bus stop, platform, or subway station. E-rickshaw stands are added by hand.
- **Google stops** are matched to ours within 30 m.
- **Shaded** = `has_shelter OR sun_fraction < 0.5`. An unmatched stop, or a stop with no shelter and no shade data for that hour, is `null`, and its wait counts as sun.

**`erickshaw_zones`**

- Hand-drawn for v1: MUJ to Dehmi Kalan, plus the areas around the Jaipur Pink Line metro stations.
- A swap is allowed only if both ends of the walk are inside a zone.
- **Fare** = `base_fare_inr + per_km_inr × ceil(km)`.

**`demand_estimates`** (nightly)

```
poi_walkers_per_day = Σ weight × exp(−distance / 150 m)   for places within 400 m
app_trips_30d       = recent trips that used this segment (chosen option, else top option)
walkers_per_day     = poi_walkers_per_day + app_trips_30d / 30
```

POI weights and distances are guesses, labelled as estimates in the portal.

**`trips` / `route_requests` / `route_choices`**

- `trips` stores the exact request and all options (with walk `segmentIds` and polylines) for 30 min.
- `route_requests` stores one row per plan call, rounded with `ST_SnapToGrid(point, 0.0005)` (~50 m).
  - Tested: `(26.84409449, 75.56526648)` → `POINT(75.5655 26.844)`.
- `trips.id` = `route_requests.id` = `tripId` (no FK).
- `route_choices`: one per trip; the last choice wins.

**`agent_messages`**

- **`content`:** Claude content blocks stored exactly as sent and received, so history replays unchanged.
- **Loading:** the last 20; never split a tool call from its result.

**`google_routes_cache`**

- **Key:** sha256 of `{origin, destination, mode, departAt floored to 15 min}`, with points at 5 decimals.
- **Why it matters:** the re-plan after a shade job hits this cache.

**`conditions_cache`**

- **Key:** `cell_id` = `"26.84:75.57"` (~1 km).
- **Kinds:**
  - `WEATHER` (Open-Meteo forecast);
  - `AIR` (Google, NAQI);
  - `WEATHER_ARCHIVE` (same day last year, for dates over 7 days ahead; key gets `@YYYY-MM-DD`).
- **Stale fallback** for up to 24 h.

---

## 5. How a request uses the tables

1. **Load the corridor:**
   ```sql
   SELECT id, from_node, to_node, length_m FROM segments
   WHERE shade_ready AND geom && :corridor_bbox AND ST_Intersects(geom, :corridor);
   ```
   Also load `segment_shade` for those ids and the trip's month.
2. **Build a small NetworkX graph.** It is usually under 1 MB, built in milliseconds.
3. **Snap** start and end to the nearest node within 60 m. If that fails, keep Google's walk with shade unknown.
4. **Edge cost** = `length_m × (1 + SHADE_ALPHA × sun_fraction × heatWeight)`, with the hour moving forward at 1.2 m/s.

---

## 6. Jobs

| Process                                                | When                                         | What                                   |
| ------------------------------------------------------ | -------------------------------------------- | -------------------------------------- |
| `worker` (`python -m app.worker`)                      | always on                                    | Shade jobs (§3)                        |
| Demand job (`app/worker/demand.py`, run by the worker) | nightly 02:00 IST; by hand: `python -m app.worker.demand` | Rewrites `demand_estimates`            |
| Stretches (`app/worker/stretches.py`)                  | after every shade job; by hand: `python -m app.worker.stretches` | Rebuilds `stretches` for those cells |
| Cleanup (in the api)                                   | trips every 10 min; the rest daily 03:00 IST | SQL below                              |
| `scripts/preload.py`                                   | before a demo                                | Queues `PRELOAD` jobs for chosen areas |

```sql
DELETE FROM trips               WHERE expires_at < now();
DELETE FROM route_requests      WHERE created_at < now() - interval '30 days';    -- also removes route_choices
DELETE FROM agent_sessions      WHERE last_active_at < now() - interval '30 days'; -- also removes messages
DELETE FROM shade_jobs          WHERE created_at < now() - interval '7 days';
DELETE FROM google_routes_cache WHERE expires_at < now();
DELETE FROM conditions_cache    WHERE expires_at < now() - interval '1 day';       -- keep 1 day for stale fallback
```

---

## 7. Migration notes

- Each migration is one `.sql` file in `api/migrations/`, named `NNNN_what.sql`. `python -m scripts.migrate` runs the files not yet listed in `schema_migrations`, in name order, each in its own transaction.
- Never edit an applied migration; add a new file.
- `0001_init.sql` starts with `CREATE EXTENSION IF NOT EXISTS postgis`.
- **Connection pools:** api 10, worker 3.

---

## 8. Settings used by the database side

| Name                                                                         | Default                  | Used by    |
| ---------------------------------------------------------------------------- | ------------------------ | ---------- |
| `DATABASE_URL`, `CLIENT_ID_SALT`                                             | Secrets Manager          | all        |
| `REPRESENTATIVE_DAY`, `MIN_SUN_ELEVATION_DEG`                                | 15, 5                    | worker     |
| `MAX_SEGMENT_M`, `STRETCH_SUN_DIFF`                                          | 50, 0.2                  | worker     |
| `STOP_MATCH_M`, `GRAPH_SNAP_MAX_M`                                           | 30, 60                   | api        |
| `STOP_SHADED_BELOW_SUN`                                                      | 0.5                      | api        |
| `DEMAND_RADIUS_M`, `DEMAND_DECAY_M`                                          | 400, 150                 | demand job |
| `PRIVACY_GRID_DEG`                                                           | 0.0005                   | api        |
| `CORRIDOR_BUFFER_M`, `MAX_CELLS_PER_JOB`, `MAX_NEW_CELLS_PER_CLIENT_PER_DAY` | 100, 120, 60             | api        |
| `SOLAR_MONTHLY_CALL_BUDGET`, `WORKER_SOLAR_CONCURRENCY`, `OVERPASS_URLS`     | 6500, 4, public Overpass | worker     |

---

## 9. SQL (migration `0001_init`)

```sql
-- SunSkip database schema, v1 (on-demand shade, anywhere in India)
-- PostgreSQL 16 + PostGIS 3.4 (Amazon RDS)
-- All geometry is EPSG:4326 (lng/lat). All timestamps are timestamptz (stored UTC).

CREATE EXTENSION IF NOT EXISTS postgis;

-- =========================================================================
-- 1. ON-DEMAND SHADE DATA  (written by the shade worker)
--    The world is split into geohash cells. A cell is fetched from Google Solar the
--    first time any trip or map view needs it, then cached forever.
-- =========================================================================

-- One row per geohash-7 cell (~153 m x 153 m at the equator, narrower east-west further north).
-- One Solar dataLayers call (radius 100 m, centred on the cell) covers the whole cell.
CREATE TABLE shade_cells (
    geohash          text PRIMARY KEY CHECK (length(geohash) = 7),
    footprint        geometry(Polygon, 4326) NOT NULL,        -- the geohash cell itself
    status           text        NOT NULL DEFAULT 'PENDING'
                     CHECK (status IN ('PENDING','FETCHING','READY','NO_DATA','ERROR','BUDGET_EXCEEDED')),
    imagery_date     date,
    imagery_quality  text        CHECK (imagery_quality IN ('HIGH','MEDIUM','BASE')),
    s3_prefix        text        UNIQUE,     -- s3://bucket/shade/<geohash>/ holds month_01.tif .. month_12.tif
    attempts         smallint    NOT NULL DEFAULT 0,
    last_error       text,
    requested_at     timestamptz NOT NULL DEFAULT now(),
    ready_at         timestamptz,
    CHECK ((status = 'READY') = (s3_prefix IS NOT NULL AND imagery_date IS NOT NULL))
);
CREATE INDEX shade_cells_footprint_gix ON shade_cells USING gist (footprint);
CREATE INDEX shade_cells_status_ix     ON shade_cells (status);

-- One row per geohash-6 area (~1.2 km x 0.6 km) whose OSM walkways, stops and POIs we loaded.
CREATE TABLE osm_areas (
    geohash      text PRIMARY KEY CHECK (length(geohash) = 6),
    footprint    geometry(Polygon, 4326) NOT NULL,
    status       text        NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','FETCHING','READY','ERROR')),
    attempts     smallint    NOT NULL DEFAULT 0,
    last_error   text,
    fetched_at   timestamptz
);
CREATE INDEX osm_areas_footprint_gix ON osm_areas USING gist (footprint);

-- Work queue for the shade worker (Postgres queue: SELECT ... FOR UPDATE SKIP LOCKED).
CREATE TABLE shade_jobs (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),     -- jobId
    status        text        NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','RUNNING','DONE','FAILED')),
    reason        text        NOT NULL CHECK (reason IN ('PLAN','MAP','PORTAL','PRELOAD')),
    client_hash   text,                                          -- NULL for PORTAL / PRELOAD
    osm_areas     text[]      NOT NULL DEFAULT '{}',             -- geohash-6 ids to load
    cells         text[]      NOT NULL DEFAULT '{}',             -- geohash-7 ids to fetch
    cells_done    smallint    NOT NULL DEFAULT 0,
    cells_no_data smallint    NOT NULL DEFAULT 0,
    error         text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    started_at    timestamptz,
    finished_at   timestamptz,
    CHECK (cardinality(cells) <= 120)
);
CREATE INDEX shade_jobs_queue_ix ON shade_jobs (created_at) WHERE status = 'QUEUED';

-- =========================================================================
-- 2. WALKING GRAPH AND SHADE  (shade worker; queried per request, built into NetworkX on the fly)
-- =========================================================================

CREATE TABLE graph_nodes (
    id    bigint PRIMARY KEY,                     -- OSM node id; negative = split point, -(hash(way_id, index) >> 1)
    geom  geometry(Point, 4326) NOT NULL
);
CREATE INDEX graph_nodes_geom_gix ON graph_nodes USING gist (geom);

CREATE TABLE stretches (
    id               integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,   -- API id: 'str_' + zero-padded to 3 digits
    name             text,                         -- from OSM name, or set by us (e.g. 'GHS footpath')
    geom             geometry(MultiLineString, 4326) NOT NULL,
    length_m         real        NOT NULL CHECK (length_m > 0),
    computed_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stretches_geom_gix ON stretches USING gist (geom);

CREATE TABLE segments (
    id               integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,   -- API id: 'seg_' + id
    from_node        bigint      NOT NULL REFERENCES graph_nodes(id),
    to_node          bigint      NOT NULL REFERENCES graph_nodes(id),
    osm_way_id       bigint      NOT NULL,
    way_seq          smallint    NOT NULL,         -- position along the OSM way; (osm_way_id, way_seq) makes reloads idempotent
    highway          text        NOT NULL,         -- OSM highway tag: footway, path, residential, service ...
    name             text,
    geom             geometry(LineString, 4326) NOT NULL,
    length_m         real        NOT NULL CHECK (length_m > 0 AND length_m <= 50),
    shade_ready      boolean     NOT NULL DEFAULT false,   -- true once every 5 m sample point falls in a READY or NO_DATA cell
    stretch_id       integer     REFERENCES stretches(id) ON DELETE SET NULL,
    UNIQUE (osm_way_id, way_seq),
    CHECK (from_node <> to_node)
);
CREATE INDEX segments_geom_gix   ON segments USING gist (geom);
CREATE INDEX segments_stretch_ix ON segments (stretch_id);

CREATE TABLE segment_shade (
    segment_id     integer  NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
    month          smallint NOT NULL CHECK (month BETWEEN 1 AND 12),
    hour           smallint NOT NULL CHECK (hour BETWEEN 0 AND 23),   -- IST hour = Solar band index
    sun_fraction   real     NOT NULL CHECK (sun_fraction BETWEEN 0 AND 1),   -- over points WITH data
    nodata_fraction real    NOT NULL DEFAULT 0 CHECK (nodata_fraction BETWEEN 0 AND 1),
    PRIMARY KEY (segment_id, month, hour)
);

-- =========================================================================
-- 3. STOPS, E-RICKSHAW ZONES, POIs  (shade worker from OSM + hand-drawn zones)
-- =========================================================================

CREATE TABLE stops (
    id               integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    kind             text     NOT NULL CHECK (kind IN ('BUS','METRO','ERICKSHAW')),
    name             text     NOT NULL,
    osm_node_id      bigint   UNIQUE,
    geom             geometry(Point, 4326) NOT NULL,
    has_shelter      boolean  NOT NULL DEFAULT false    -- OSM shelter=yes
);
CREATE INDEX stops_geom_gix ON stops USING gist (geom);

CREATE TABLE stop_shade (
    stop_id       integer  NOT NULL REFERENCES stops(id) ON DELETE CASCADE,
    month         smallint NOT NULL CHECK (month BETWEEN 1 AND 12),
    hour          smallint NOT NULL CHECK (hour BETWEEN 0 AND 23),
    sun_fraction  real     NOT NULL CHECK (sun_fraction BETWEEN 0 AND 1),  -- share of pixels within 5 m of the stop in sun
    PRIMARY KEY (stop_id, month, hour)
);

CREATE TABLE erickshaw_zones (
    id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name          text     NOT NULL UNIQUE,
    geom          geometry(Polygon, 4326) NOT NULL,
    base_fare_inr smallint NOT NULL CHECK (base_fare_inr >= 0),
    per_km_inr    smallint NOT NULL CHECK (per_km_inr >= 0),
    fare_source   text     NOT NULL DEFAULT 'FORMULA' CHECK (fare_source IN ('FORMULA','COLLECTED')),
    active        boolean  NOT NULL DEFAULT true,
    notes         text
);
CREATE INDEX erickshaw_zones_geom_gix ON erickshaw_zones USING gist (geom);

CREATE TABLE pois (
    id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    osm_id      text     UNIQUE,                 -- 'node/123', 'way/456'
    kind        text     NOT NULL CHECK (kind IN ('HOSTEL','CAMPUS_GATE','ACADEMIC','STOP','FOOD','SHOP','OTHER')),
    name        text,
    geom        geometry(Point, 4326) NOT NULL,  -- centroid for ways
    weight      real     NOT NULL CHECK (weight >= 0)   -- estimated walkers/day it generates; labelled estimate
);
CREATE INDEX pois_geom_gix ON pois USING gist (geom);

CREATE TABLE demand_estimates (
    segment_id          integer PRIMARY KEY REFERENCES segments(id) ON DELETE CASCADE,
    poi_walkers_per_day real    NOT NULL DEFAULT 0 CHECK (poi_walkers_per_day >= 0),
    app_trips_30d       integer NOT NULL DEFAULT 0 CHECK (app_trips_30d >= 0),
    walkers_per_day     real    NOT NULL DEFAULT 0 CHECK (walkers_per_day >= 0),
    computed_at         timestamptz NOT NULL DEFAULT now()
);

-- =========================================================================
-- 4. TRIPS AND LOGS  (written by the API)
-- =========================================================================

-- Live trips: exact coordinates, deleted 30 min after creation.
CREATE TABLE trips (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),      -- tripId
    client_hash  text        NOT NULL,
    request      jsonb       NOT NULL,      -- the PlanRequest as received
    options      jsonb       NOT NULL,      -- RouteOption[] incl. polylines and walk segment ids
    created_at   timestamptz NOT NULL DEFAULT now(),
    expires_at   timestamptz NOT NULL DEFAULT now() + interval '30 minutes'
);
CREATE INDEX trips_expires_ix ON trips (expires_at);

-- Request log: rounded to ~50 m, kept 30 days. id = tripId when status = 'OK'.
CREATE TABLE route_requests (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_hash         text        NOT NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),
    origin_rounded      geometry(Point, 4326) NOT NULL,
    dest_rounded        geometry(Point, 4326),
    depart_at           timestamptz NOT NULL,
    preference          real        NOT NULL CHECK (preference BETWEEN 0 AND 1),
    status              text        NOT NULL CHECK (status IN ('OK','NO_ROUTE_FOUND','UPSTREAM_ERROR','INTERNAL_ERROR')),
    coverage            text        CHECK (coverage IN ('FULL','PARTIAL','NONE')),
    shade_status        text        CHECK (shade_status IN ('READY','PREPARING','UNAVAILABLE')),
    shade_job_id        uuid,
    option_count        smallint    NOT NULL DEFAULT 0,
    top_option_id       text,
    top_sun_minutes     real,
    top_segment_ids     integer[]   NOT NULL DEFAULT '{}',
    latency_ms          integer
);
CREATE INDEX route_requests_created_ix ON route_requests (created_at);

CREATE TABLE route_choices (
    trip_id        uuid PRIMARY KEY REFERENCES route_requests(id) ON DELETE CASCADE,
    option_id      text        NOT NULL,
    labels         text[]      NOT NULL DEFAULT '{}',
    sun_minutes    real,                   -- NULL while shade is unknown
    segment_ids    integer[]   NOT NULL DEFAULT '{}',
    chosen_at      timestamptz NOT NULL DEFAULT now()
);

-- =========================================================================
-- 5. AGENT MEMORY  (kept 30 days after last activity)
-- =========================================================================

CREATE TABLE agent_sessions (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),   -- sessionId
    client_hash     text        NOT NULL,
    language        text        NOT NULL DEFAULT 'en-IN',
    created_at      timestamptz NOT NULL DEFAULT now(),
    last_active_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_sessions_active_ix ON agent_sessions (last_active_at);

CREATE TABLE agent_messages (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    session_id     uuid        NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
    role           text        NOT NULL CHECK (role IN ('user','assistant')),
    content        jsonb       NOT NULL,   -- Claude content blocks exactly as sent/received (text, tool_use, tool_result)
    original_text  text,                   -- user's words before Sarvam translation
    language       text,
    created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_messages_session_ix ON agent_messages (session_id, id);

-- =========================================================================
-- 6. CACHES AND STATUS
-- =========================================================================

CREATE TABLE google_routes_cache (
    cache_key   text PRIMARY KEY,          -- sha256 of normalised request
    response    jsonb       NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    expires_at  timestamptz NOT NULL DEFAULT now() + interval '24 hours'
);
CREATE INDEX google_routes_cache_expires_ix ON google_routes_cache (expires_at);

CREATE TABLE conditions_cache (
    cell_id     text NOT NULL,             -- '26.84:75.57' (0.01 deg, ~1 km); WEATHER_ARCHIVE adds '@YYYY-MM-DD'
    kind        text NOT NULL CHECK (kind IN ('WEATHER','AIR','WEATHER_ARCHIVE')),
    payload     jsonb       NOT NULL,
    source      text        NOT NULL,      -- 'open-meteo', 'open-meteo-archive', 'google-air-quality'
    fetched_at  timestamptz NOT NULL DEFAULT now(),
    expires_at  timestamptz NOT NULL DEFAULT now() + interval '15 minutes',
    PRIMARY KEY (cell_id, kind)
);

CREATE TABLE service_status (
    service          text PRIMARY KEY CHECK (service IN ('google_routes','google_air','google_solar','overpass','open_meteo','claude','sarvam','worker')),  -- 'worker' = heartbeat
    last_success_at  timestamptz,
    last_error_at    timestamptz,
    last_error       text
);
INSERT INTO service_status (service) VALUES
  ('google_routes'),('google_air'),('google_solar'),('overpass'),('open_meteo'),('claude'),('sarvam'),('worker');

-- Monthly Solar call counter, so we never silently leave the free tier.
CREATE TABLE solar_usage (
    month_start  date PRIMARY KEY,               -- first day of the month (IST)
    calls        integer NOT NULL DEFAULT 0 CHECK (calls >= 0)
);

-- Which migration files have run (written by scripts/migrate.py).
CREATE TABLE IF NOT EXISTS schema_migrations (
    name        text PRIMARY KEY,
    applied_at  timestamptz NOT NULL DEFAULT now()
);
```

---

## 10. Key queries (all tested)

**Cells and OSM areas for a walk corridor** (tested: a straight 570 m corridor at MUJ, 100 m buffer → 12 cells, 5 areas):

```sql
WITH corr AS (SELECT ST_Buffer(:walk_line::geography, 100)::geometry c),
pts AS (SELECT ST_Centroid(sq.geom) p FROM corr, ST_SquareGrid(0.0003, corr.c) sq)
SELECT array_agg(DISTINCT ST_GeoHash(p, 7)) AS cells,
       array_agg(DISTINCT ST_GeoHash(p, 6)) AS osm_areas
FROM pts, corr WHERE ST_Intersects(p, c);
```

**Worker takes the next job:**

```sql
UPDATE shade_jobs SET status = 'RUNNING', started_at = now()
WHERE id = (SELECT id FROM shade_jobs WHERE status = 'QUEUED'
            ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
RETURNING id, osm_areas, cells;
```

**Count a Solar call against the budget:**

```sql
INSERT INTO solar_usage (month_start, calls)
VALUES (date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata')::date, 1)
ON CONFLICT (month_start) DO UPDATE SET calls = solar_usage.calls + 1
RETURNING calls;   -- over budget → mark the cell BUDGET_EXCEEDED and skip the call
```

**Shade map** (`/shade/segments`):

```sql
SELECT s.id, ST_AsGeoJSON(s.geom)::json AS geometry, s.length_m,
       COALESCE(sh.sun_fraction, 0) AS sun_fraction
FROM segments s
LEFT JOIN segment_shade sh ON sh.segment_id = s.id AND sh.month = :month AND sh.hour = :hour
WHERE s.shade_ready AND s.geom && ST_MakeEnvelope(:w, :s, :e, :n, 4326);
```

**Pain score per stretch** (`/portal/heat-pain`; tested → `str_001`, pain 100):

```sql
WITH seg AS (
  SELECT s.stretch_id, s.length_m, d.walkers_per_day, COALESCE(avg(sh.sun_fraction), 0) AS sun
  FROM segments s
  JOIN demand_estimates d ON d.segment_id = s.id
  LEFT JOIN segment_shade sh ON sh.segment_id = s.id AND sh.month = :month AND sh.hour BETWEEN :h1 AND :h2
  WHERE s.geom && ST_MakeEnvelope(:w, :s, :e, :n, 4326)
  GROUP BY s.id, s.stretch_id, s.length_m, d.walkers_per_day
), st AS (
  SELECT stretch_id,
         sum(walkers_per_day * length_m) / sum(length_m) AS walkers_per_day,
         sum(sun * length_m) / sum(length_m)             AS sun_share,
         sum(length_m)                                   AS length_m
  FROM seg GROUP BY stretch_id
)
SELECT st.*, 100 * (walkers_per_day * sun_share * length_m)
             / NULLIF(max(walkers_per_day * sun_share * length_m) OVER (), 0) AS pain_score
FROM st ORDER BY pain_score DESC;
```

**Is a stop shaded at this hour?**

```sql
SELECT COALESCE(st.has_shelter OR ss.sun_fraction < 0.5, false) AS stop_shaded
FROM stops st LEFT JOIN stop_shade ss ON ss.stop_id = st.id AND ss.month = :month AND ss.hour = :hour
WHERE st.id = :stop_id;
```

**App trips per segment, last 30 days** (demand job):

```sql
SELECT seg_id, count(*) AS trips
FROM (SELECT unnest(COALESCE(c.segment_ids, r.top_segment_ids)) AS seg_id
      FROM route_requests r LEFT JOIN route_choices c ON c.trip_id = r.id
      WHERE r.status = 'OK' AND r.created_at > now() - interval '30 days') x
GROUP BY seg_id;
```

**Checks that fired in testing:**

- a `READY` cell without `s3_prefix` is rejected;
- reloading the same OSM segments adds nothing (unique `osm_way_id, way_seq`).
