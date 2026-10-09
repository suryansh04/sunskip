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
