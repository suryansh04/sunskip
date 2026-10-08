# Backend Core Implementation Plan (pieces 1–4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A running `api/` (FastAPI) + `worker` that reproduces the MUJ pilot numbers (810 m, 11.3 min at 1 PM, 7.4 min at 5 PM) from real Google Solar + OSM data, with every app endpoint except agent/voice working.

**Architecture:** One Python package `api/app` started two ways: `uvicorn app.main:app` (HTTP) and `python -m app.worker` (shade-job loop). They share Postgres + PostGIS and never call each other; the `shade_jobs` table connects them. SQL is plain text run through an `asyncpg` pool.

**Tech Stack:** Python 3.12, FastAPI, Pydantic v2, asyncpg, httpx, boto3, networkx, numpy, rasterio, shapely, pyproj, pvlib, PostgreSQL 16 + PostGIS 3.4 (Docker locally).

**Spec:** `docs/api.md`, `docs/schema.md`, `docs/TRD.md` §5 and §8, `CLAUDE.md` (team rules). Pieces 5 (portal + demand job) and 6 (AWS deploy) get their own plan later.

## Global Constraints

- Follow every rule in `CLAUDE.md`. In particular: **no test files** (each task ends with a manual check), no dead code, no magic numbers (tunables in `config.py`), early returns, type hints on every function, functions under ~40 lines, files under ~300 lines.
- camelCase JSON via `ApiModel` (`alias_generator=to_camel`, `populate_by_name=True`).
- Error body is always `{ "error": { "code", "message", "requestId" } }`.
- Unknown values are `null`, never `0`. Round displayed decimals half up (`round_half_up`).
- Every outside call: 10 s timeout, wrapped in `track_service(...)`, never logs keys, URLs with keys or bodies.
- Every request finishes under 29 s and never waits for shade data.
- All paths are under `/v1`. Times are ISO 8601 with `+05:30`. Shade hours are IST 0–23.
- `ruff check` must pass before each commit.

---

## Decisions for your OK before we start

### Simplifications (rule 9: no API or schema contract change)

| # | Docs say | Plan does | Why |
|---|---|---|---|
| D1 | SQLAlchemy 2 async + GeoAlchemy2 + Alembic | **`asyncpg` pool + plain SQL.** Migrations are `api/migrations/NNNN_name.sql`, applied by `python -m scripts.migrate` (≈25 lines) | schema.md already gives us raw SQL. Drops 3 packages, the ORM models, `alembic.ini`, `env.py` and the async-template boilerplate |
| D2 | Cleanup: trips every 10 min, the rest daily 03:00 | All cleanup SQL every 10 min | One loop instead of two schedules; the deletes are cheap |
| D3 | Split OSM ways "at junctions" | Split every way **at every OSM node**, then at 50 m | Same result after the graph is built, but it doesn't depend on which neighbouring areas are loaded, so reloads stay identical |
| D4 | Edge cost uses the hour moving forward as you walk | Edge cost uses the **hour at the start of the walk**; exposure (sun minutes, dose) still moves the hour forward | Time-dependent Dijkstra for a 10-minute walk isn't worth it |
| D5 | Call Google Routes at `departAt` | Call Google at the **next future date with the same weekday and clock time**, then shift the times back to `departAt` | Google transit can't route past dates, and the demo is in May mode (15 May 2026 is already past) |
| D6 | Shade files only in S3 | Files are written to a local cache (`api/.data/`) **and** to S3 when `S3_BUCKET` is set; reads use the cache first | Scoring reads hundreds of tiles; local disk is far faster, and dev works without S3 |
| D7 | Waypoint `cue` in the requested language | `cue` is English; the `language` param is accepted and ignored. P2's `/voice/instructions` translates | Translation belongs to P2's Sarvam code |
| D8 | NAQI for any `at` | NAQI only when `at` is within 1 h of now, otherwise `null` | Google Air Quality "current conditions" has no forecast |
| D9 | Hand-drawn e-rickshaw zones | Circles: 3 km around MUJ (covers Dehmi Kalan), 1.5 km around each Jaipur metro station. Fare ₹10 + ₹10/km, marked estimate | No time to draw polygons; same behaviour |

### Contract changes that need your yes (rule 6)

| # | Change | Why |
|---|---|---|
| A1 | **Drop the in-memory rate limiter** (the `429 RATE_LIMITED` row stays documented as "not used in v1"). API Gateway's 50 req/s throttle stays. P2 can add a simple per-client limit for `/agent` and `/voice` later if Claude/Sarvam cost needs it | Removes the limiter code and the single-process constraint |
| A2 | **Drop `date=` on `GET /shade/segments`**, keep `month=` only | One way to say the same thing |
| S1 | `route_choices.sun_minutes` becomes **nullable** | `sunMinutes` is `null` while shade is preparing, so `POST /choice` would crash on `NOT NULL` |
| S2 | `service_status.service` CHECK also allows **`'worker'`** | The worker heartbeat (TRD §5.3, `/health`) is stored there, but the CHECK forbids it |
| S3 | New bookkeeping table **`schema_migrations (name, applied_at)`** | Needed by D1's migration runner |

If you approve, Task 0 updates `api.md`, `schema.md`, `TRD.md` and `CLAUDE.md` to match before any code.

### Things I need from you

1. **The Bus 26 stop coordinates** (the pilot walk's end point), or `route_shade.csv`. Used to preload MUJ and to check 11.3 / 7.4.
2. **The GitHub repo URL**, or should we keep the repo local for now?
3. **A rotated Google key** limited to Routes, Solar and Air Quality, put in `api/.env` (never committed).

---

## File map

```
.gitignore                          (repo root)
api/
  requirements.txt  Dockerfile  docker-compose.yml  docker-compose.dev.yml  .env.example
  migrations/0001_init.sql          schema.md §9 + S1/S2/S3 changes
  scripts/migrate.py                applies migrations
  scripts/preload.py                queues PRELOAD jobs (Task 9)
  scripts/seed_zones.py             e-rickshaw zones (Task 13)
  app/
    main.py                         app, middleware, routers, lifespan
    config.py                       Settings + Secrets Manager + IST
    core/errors.py                  ApiError, error_response, handlers
    core/middleware.py              request id, origin secret, client hash
    core/http.py                    shared httpx client, track_service
    core/formulas.py                round_half_up, heat_weight, dose_weight
    core/geo.py                     geohash, haversine, bearing, sample_line
    core/sun.py                     sun elevations (pvlib)
    core/storage.py                 local cache + S3
    contracts/models.py             Pydantic shapes (api.md §4)
    contracts/fakes.py              Bus 26 numbers for USE_FAKES
    db/pool.py                      asyncpg pool
    db/status_queries.py            service_status, health counts
    db/shade_queries.py             cells, jobs, segments, shade
    db/trip_queries.py              trips, route_requests, route_choices
    db/cache_queries.py             google_routes_cache, conditions_cache
    db/cleanup.py                   10-minute cleanup loop
    meta/router.py
    health/router.py
    conditions/router.py  conditions/weather.py  conditions/air.py
    shade/router.py  shade/queue.py
    routes/router.py  routes/google.py  routes/legs.py  routes/walk.py
    routes/exposure.py  routes/ranking.py  routes/erickshaw.py
    routes/plan.py  routes/best_time.py  routes/waypoints.py
    portal/router.py                501 stubs until piece 5
    agent/router.py  voice/router.py  501 stubs for P2
    worker/__main__.py  worker/job.py  worker/overpass.py
    worker/solar.py  worker/scoring.py
```

---

### Task 0: Repo + doc updates

**Files:** Create `.gitignore`. Modify `docs/api.md`, `docs/schema.md`, `docs/TRD.md`, `CLAUDE.md`.

- [ ] **Step 1:** `git init` in the repo root, then create `.gitignore`:

```gitignore
.env
.venv/
__pycache__/
*.pyc
node_modules/
dist/
api/.data/
```

- [ ] **Step 2:** Apply the approved decisions to the docs:
  - api.md §3: limits mark `429` as not used in v1 (A1); §6.2: remove `date=` (A2).
  - schema.md: S1, S2, S3 in §9; §7 "Alembic notes" replaced by "Migrations: plain SQL files in `api/migrations/`, applied in name order by `python -m scripts.migrate`".
  - TRD: §5.1 stack row DB becomes `asyncpg`; §5.2 tree shows `migrations/` instead of `alembic/`; §5.3 drops the rate-limit sentence and the Alembic bullet; §8.1 step 5 becomes `docker compose run --rm api python -m scripts.migrate`; `requirements.txt` block matches Task 1.
  - CLAUDE.md: folder tree `alembic/` becomes `migrations/`; "SQL lives in `db/queries.py`" becomes "SQL lives in `db/*_queries.py`"; local run uses `python -m scripts.migrate`.
- [ ] **Step 3:** Commit: `git add -A && git commit -m "docs: apply backend simplifications"`.

---

### Task 1: Skeleton (config, DB, errors, middleware, models, 18 stub routes, Docker)

**Files:** everything under `api/` listed for this task in the file map except `core/http.py … core/storage.py` (Task 2).

**Interfaces:**
- Produces: `settings` (`app.config`), `IST`, `get_pool() -> asyncpg.Pool`, `open_pool(max_size: int)`, `close_pool()`, `ApiError(status, code, message, extra=None)`, `not_implemented() -> ApiError`, `ApiModel` and all models in `contracts/models.py`, `request.state.client_hash: str | None`, `request.state.request_id: str`.

- [ ] **Step 1: venv + requirements.** `cd api && py -3.12 -m venv .venv && .venv\Scripts\activate`. Create `requirements.txt`:

```
fastapi==0.142.4
uvicorn[standard]
pydantic-settings
asyncpg
httpx
boto3
networkx==3.7
numpy
rasterio==1.5.2
shapely
pyproj
pvlib==0.16.1
anthropic==1.12.1
sarvamai==0.1.36
ruff
```

Run `pip install -r requirements.txt`.

- [ ] **Step 2: `app/config.py`**

```python
import json
from zoneinfo import ZoneInfo

import boto3
from pydantic_settings import BaseSettings, SettingsConfigDict

IST = ZoneInfo("Asia/Kolkata")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Secrets (Secrets Manager in production, .env locally)
    google_api_key: str = ""
    anthropic_api_key: str = ""
    sarvam_api_key: str = ""
    database_url: str = "postgresql://sunskip:sunskip@localhost:5432/sunskip"
    origin_secret: str = ""
    client_id_salt: str = "local-dev-salt"

    # Deploy
    secret_id: str = ""
    aws_region: str = "ap-south-1"
    s3_bucket: str = ""
    origin_secret_check: bool = True
    use_fakes: bool = False
    api_pool_size: int = 10
    worker_pool_size: int = 3
    outside_call_timeout_s: float = 10

    # Walking and heat (api.md §11)
    walk_speed_mps: float = 1.2
    heat_alert_feels_like_c: float = 40
    shade_alpha: float = 3.0
    max_detour_ratio: float = 1.3
    default_wait_seconds: int = 300
    long_wait_in_sun_min: float = 5
    walk_only_max_m: float = 3000
    max_options: int = 6
    swap_min_walk_m: float = 500
    swap_min_hot_sun_min: float = 5
    erickshaw_speed_mps: float = 4.2
    erickshaw_wait_seconds: int = 120
    waypoint_spacing_m: float = 25

    # Shade data (api.md §11, schema.md §8)
    corridor_buffer_m: float = 100
    max_cells_per_job: int = 120
    max_new_cells_per_client_per_day: int = 60
    max_shade_map_km2: float = 1
    solar_monthly_call_budget: int = 6500
    worker_solar_concurrency: int = 4
    overpass_url: str = "https://overpass-api.de/api/interpreter"
    representative_day: int = 15
    min_sun_elevation_deg: float = 5
    max_segment_m: float = 50
    shade_sample_spacing_m: float = 5
    stop_match_m: float = 30
    graph_snap_max_m: float = 60
    privacy_grid_deg: float = 0.0005
    poll_after_seconds: int = 3

    # Worker loop
    stuck_after_minutes: int = 10
    heartbeat_interval_s: float = 30
    worker_idle_sleep_s: float = 2
    cleanup_interval_s: float = 600


def load_settings() -> Settings:
    local_settings = Settings()
    if not local_settings.secret_id:
        return local_settings
    client = boto3.client("secretsmanager", region_name=local_settings.aws_region)
    secret_text = client.get_secret_value(SecretId=local_settings.secret_id)["SecretString"]
    secrets = {key.lower(): value for key, value in json.loads(secret_text).items()}
    return Settings(**secrets)


settings = load_settings()
```

- [ ] **Step 3: `app/db/pool.py`**

```python
import json

import asyncpg

from app.config import settings

_pool: asyncpg.Pool | None = None


async def _use_json_codecs(connection: asyncpg.Connection) -> None:
    for type_name in ("json", "jsonb"):
        await connection.set_type_codec(
            type_name, encoder=json.dumps, decoder=json.loads, schema="pg_catalog"
        )


async def open_pool(max_size: int) -> None:
    global _pool
    _pool = await asyncpg.create_pool(
        settings.database_url, min_size=1, max_size=max_size, init=_use_json_codecs
    )


async def close_pool() -> None:
    if _pool:
        await _pool.close()


def get_pool() -> asyncpg.Pool:
    return _pool
```

- [ ] **Step 4: `migrations/0001_init.sql`.** Copy schema.md §9 verbatim, then apply S1–S3:
  - `route_choices.sun_minutes real,` (no `NOT NULL`)
  - `service_status` CHECK list gets `'worker'`, and the INSERT gets `('worker')`
  - add at the end:

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
    name        text PRIMARY KEY,
    applied_at  timestamptz NOT NULL DEFAULT now()
);
```

- [ ] **Step 5: `scripts/migrate.py`**

```python
import asyncio
from pathlib import Path

import asyncpg

from app.config import settings

MIGRATIONS_DIR = Path(__file__).resolve().parent.parent / "migrations"


async def apply_migrations() -> None:
    connection = await asyncpg.connect(settings.database_url)
    try:
        await connection.execute(
            "CREATE TABLE IF NOT EXISTS schema_migrations "
            "(name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"
        )
        applied = {row["name"] for row in await connection.fetch("SELECT name FROM schema_migrations")}
        for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
            if path.name in applied:
                continue
            async with connection.transaction():
                await connection.execute(path.read_text(encoding="utf-8"))
                await connection.execute("INSERT INTO schema_migrations (name) VALUES ($1)", path.name)
            print(f"applied {path.name}")
    finally:
        await connection.close()


if __name__ == "__main__":
    asyncio.run(apply_migrations())
```

- [ ] **Step 6: `app/core/errors.py`**

```python
import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException

logger = logging.getLogger(__name__)


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str, extra: dict | None = None):
        self.status = status
        self.code = code
        self.message = message
        self.extra = extra or {}


def not_implemented() -> ApiError:
    return ApiError(501, "NOT_IMPLEMENTED", "This endpoint is not built yet")


def error_response(
    request: Request, status: int, code: str, message: str, extra: dict | None = None
) -> JSONResponse:
    request_id = getattr(request.state, "request_id", None)
    body = {"error": {"code": code, "message": message, "requestId": request_id, **(extra or {})}}
    return JSONResponse(body, status_code=status)


async def _handle_api_error(request: Request, error: ApiError) -> JSONResponse:
    return error_response(request, error.status, error.code, error.message, error.extra)


async def _handle_validation_error(request: Request, error: RequestValidationError) -> JSONResponse:
    first = error.errors()[0]
    field = ".".join(str(part) for part in first["loc"][1:])
    return error_response(request, 400, "INVALID_REQUEST", f"{field}: {first['msg']}")


async def _handle_http_error(request: Request, error: HTTPException) -> JSONResponse:
    code = "NOT_FOUND" if error.status_code == 404 else "INVALID_REQUEST"
    return error_response(request, error.status_code, code, str(error.detail))


async def _handle_unexpected_error(request: Request, error: Exception) -> JSONResponse:
    logger.exception("Unhandled error")
    return error_response(request, 500, "INTERNAL_ERROR", "Something went wrong on our side")


def add_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(ApiError, _handle_api_error)
    app.add_exception_handler(RequestValidationError, _handle_validation_error)
    app.add_exception_handler(HTTPException, _handle_http_error)
    app.add_exception_handler(Exception, _handle_unexpected_error)
```

- [ ] **Step 7: `app/core/middleware.py`**

```python
import hashlib
import hmac
import uuid

from fastapi import Request

from app.config import settings
from app.core.errors import error_response

CLIENT_ID_FREE_PATHS = ("/v1/portal/", "/v1/health", "/docs", "/openapi.json")


def hash_client_id(client_id: str) -> str:
    return hmac.new(settings.client_id_salt.encode(), client_id.encode(), hashlib.sha256).hexdigest()


def _has_origin_secret(request: Request) -> bool:
    sent_secret = request.headers.get("X-Origin-Secret", "")
    return hmac.compare_digest(sent_secret, settings.origin_secret)


async def _check_then_call(request: Request, call_next):
    if settings.origin_secret_check and not _has_origin_secret(request):
        return error_response(request, 403, "FORBIDDEN", "No access")
    client_id = request.headers.get("X-Client-Id")
    request.state.client_hash = hash_client_id(client_id) if client_id else None
    if not client_id and not request.url.path.startswith(CLIENT_ID_FREE_PATHS):
        return error_response(request, 400, "INVALID_REQUEST", "X-Client-Id header is required")
    return await call_next(request)


async def guard_request(request: Request, call_next):
    request.state.request_id = str(uuid.uuid4())
    response = await _check_then_call(request, call_next)
    response.headers["X-Request-Id"] = request.state.request_id
    return response
```

- [ ] **Step 8: `app/contracts/models.py`.** All api.md §4 shapes plus request bodies. Every class extends `ApiModel`:

```python
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator
from pydantic.alias_generators import to_camel

Mode = Literal["WALK", "BUS", "METRO", "RAIL", "ERICKSHAW"]
Warning = Literal[
    "HEAT_ALERT", "FARE_ESTIMATED", "LONG_WAIT_IN_SUN",
    "SHADE_PREPARING", "NO_SHADE_DATA", "NO_SHADE_DATA_PARTIAL",
]


class ApiModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class LatLng(ApiModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)


class PlaceInput(ApiModel):
    lat: float | None = Field(default=None, ge=-90, le=90)
    lng: float | None = Field(default=None, ge=-180, le=180)
    query: str | None = Field(default=None, min_length=2, max_length=200)

    @model_validator(mode="after")
    def needs_point_or_query(self):
        if self.query or (self.lat is not None and self.lng is not None):
            return self
        raise ValueError("send either lat and lng, or query")


class Place(ApiModel):
    name: str | None = None
    location: LatLng


class Shade(ApiModel):
    status: Literal["READY", "PREPARING", "UNAVAILABLE"]
    job_id: str | None = None
    cells_total: int | None = None
    cells_done: int | None = None
    poll_after_seconds: int | None = None


class Exposure(ApiModel):
    walk_meters: float
    walk_minutes: float
    sun_minutes: float | None = None
    sun_minutes_hot: float | None = None
    wait_sun_minutes: float | None = None
    shade_pct: float | None = None
    heat_dose: float | None = None
    feels_like_c: float | None = None


class TransitLine(ApiModel):
    short_name: str | None = None
    name: str | None = None
    vehicle: Mode
    headway_seconds: int | None = None


class Leg(ApiModel):
    mode: Mode
    from_: Place = Field(alias="from")
    to: Place
    start_at: datetime
    end_at: datetime
    distance_meters: float
    duration_seconds: int
    polyline: dict  # GeoJSON LineString
    shade_known: bool = False
    coverage: Literal["FULL", "PARTIAL", "NONE"] | None = None
    exposure: Exposure | None = None
    line: TransitLine | None = None
    wait_seconds: int | None = None
    stop_shaded: bool | None = None
    fare_inr: int | None = None
    swapped_from: Literal["WALK"] | None = None
    segment_ids: list[int] = Field(default_factory=list)  # stored in trips, never returned


class RouteOption(ApiModel):
    option_id: str
    labels: list[Literal["RECOMMENDED", "FASTEST", "CHEAPEST", "COOLEST"]] = Field(default_factory=list)
    depart_at: datetime
    arrive_at: datetime
    duration_seconds: int
    fare_inr: int | None = None
    exposure: Exposure
    legs: list[Leg]
    warnings: list[Warning] = Field(default_factory=list)


class PlanRequest(ApiModel):
    origin: PlaceInput
    destination: PlaceInput
    depart_at: datetime | None = None
    preference: float = Field(default=0.5, ge=0, le=1)
    allow_erickshaw: bool = True


class TripConditions(ApiModel):
    feels_like_c: float | None = None
    heat_alert: bool = False
    typical: bool = False


class PlanResponse(ApiModel):
    trip_id: str
    shade: Shade
    conditions: TripConditions
    options: list[RouteOption]


class BestTimeRequest(ApiModel):
    origin: PlaceInput
    destination: PlaceInput
    date: date
    from_: str = Field(default="07:00", alias="from", pattern=r"^\d{2}:\d{2}$")
    to: str = Field(default="19:00", pattern=r"^\d{2}:\d{2}$")
    step_minutes: Literal[15, 30, 60] = 30


class Slot(ApiModel):
    depart_at: datetime
    sun_minutes: float | None = None
    heat_dose: float | None = None


class BestSlot(ApiModel):
    depart_at: datetime


class BestTimeResponse(ApiModel):
    basis: Literal["SHADE", "TEMPERATURE_ONLY"]
    shade: Shade
    slots: list[Slot]
    best: BestSlot | None = None
    note: str


class Waypoint(ApiModel):
    index: int
    location: LatLng
    distance_from_start_m: float
    leg_index: int
    bearing_deg: float
    in_sun: bool | None = None
    cue: str | None = None


class WaypointsResponse(ApiModel):
    spacing_m: float
    waypoints: list[Waypoint]


class ChoiceRequest(ApiModel):
    option_id: str


class ShadeJob(ApiModel):
    job_id: str
    status: Literal["QUEUED", "RUNNING", "DONE", "FAILED"]
    reason: Literal["PLAN", "MAP", "PORTAL", "PRELOAD"]
    cells_total: int
    cells_done: int
    cells_no_data: int
    poll_after_seconds: int
    ready_to_replan: bool


class HourlyConditions(ApiModel):
    at: datetime
    temp_c: float | None = None
    feels_like_c: float | None = None


class Conditions(ApiModel):
    at: datetime
    temp_c: float | None = None
    feels_like_c: float | None = None
    naqi: int | None = None
    naqi_category: str | None = None
    heat_alert: bool = False
    hourly: list[HourlyConditions] = Field(default_factory=list)
    source: dict = Field(default_factory=lambda: {"weather": "open-meteo", "air": "google-air-quality"})
    stale: bool = False
    typical: bool = False
```

Routers return dumps made with `model_dump(mode="json", by_alias=True, exclude=LEG_INTERNALS)` where `LEG_INTERNALS = {"options": {"__all__": {"legs": {"__all__": {"segment_ids"}}}}}` (defined in `routes/plan.py`), so `segmentIds` is stored in `trips` but never sent.

- [ ] **Step 9: Stub routers.** One `router.py` per folder. Each endpoint has its final path and method and raises `not_implemented()`. Example (`app/routes/router.py`):

```python
from fastapi import APIRouter

from app.core.errors import not_implemented

router = APIRouter(tags=["routes"])


@router.post("/routes/plan")
async def plan_route():
    raise not_implemented()
```

Paths per folder: `meta` (`GET /meta`), `health` (`GET /health`), `conditions` (`GET /conditions`), `shade` (`GET /shade/segments`, `GET /shade/jobs/{job_id}`), `routes` (`POST /routes/plan`, `POST /routes/best-time`, `GET /routes/{trip_id}/options/{option_id}/waypoints`, `POST /routes/{trip_id}/choice`), `agent` (`POST /agent/chat`), `voice` (`POST /voice/instructions`, `/voice/tts`, `/voice/stt`), `portal` (`GET /portal/stats`, `/portal/heat-pain`, `/portal/recommendations`, `POST /portal/simulate`, `GET /portal/stretches/{stretch_id}`).

- [ ] **Step 10: `app/main.py`**

```python
import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.agent.router import router as agent_router
from app.conditions.router import router as conditions_router
from app.config import settings
from app.core.errors import add_error_handlers
from app.core.http import close_http_client
from app.core.middleware import guard_request
from app.db.cleanup import run_cleanup_forever
from app.db.pool import close_pool, open_pool
from app.health.router import router as health_router
from app.meta.router import router as meta_router
from app.portal.router import router as portal_router
from app.routes.router import router as routes_router
from app.shade.router import router as shade_router
from app.voice.router import router as voice_router

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await open_pool(settings.api_pool_size)
    cleanup_task = asyncio.create_task(run_cleanup_forever())
    yield
    cleanup_task.cancel()
    await close_http_client()
    await close_pool()


app = FastAPI(title="SunSkip API", version="1", lifespan=lifespan)
app.middleware("http")(guard_request)
add_error_handlers(app)
for router in (
    meta_router, health_router, conditions_router, shade_router, routes_router,
    agent_router, voice_router, portal_router,
):
    app.include_router(router, prefix="/v1")
```

`core/http.py` and `db/cleanup.py` come in Tasks 2 and 3. Until then, leave those two imports and lines out of `main.py` and add them in those tasks.

- [ ] **Step 11: Docker files.** `Dockerfile` and `docker-compose.dev.yml` exactly as TRD §8.1. `docker-compose.yml` as TRD §8.1 plus a shared cache volume on both services:

```yaml
    volumes: ["shade-cache:/srv/.data"]
# at the bottom:
volumes:
  shade-cache:
```

Create `.env.example`:

```
DATABASE_URL=postgresql://sunskip:sunskip@localhost:5432/sunskip
GOOGLE_API_KEY=
ORIGIN_SECRET_CHECK=false
USE_FAKES=false
S3_BUCKET=
SECRET_ID=
AWS_REGION=ap-south-1
```

- [ ] **Step 12: Manual check**
  - `docker compose -f docker-compose.dev.yml up -d`, copy `.env.example` to `.env`, run `python -m scripts.migrate` → prints `applied 0001_init.sql`. Run it again → prints nothing.
  - `uvicorn app.main:app --reload`, open `http://localhost:8000/docs` → 18 endpoints.
  - `curl -i localhost:8000/v1/meta` → `400 INVALID_REQUEST` (no client id), with an `X-Request-Id` header.
  - `curl -i -H "X-Client-Id: test" localhost:8000/v1/meta` → `501 NOT_IMPLEMENTED`.
  - Set `ORIGIN_SECRET_CHECK=true` and restart → `403 FORBIDDEN`. Set it back to false.
  - `ruff check .` is clean.
- [ ] **Step 13:** Commit `feat(api): skeleton with stubs, errors, middleware, migration`.

---

### Task 2: Shared core helpers

**Files:** Create `app/core/http.py`, `app/core/formulas.py`, `app/core/geo.py`, `app/core/sun.py`, `app/core/storage.py`, `app/db/status_queries.py`. Modify `app/main.py` (close the http client).

**Interfaces (produces):**
- `http_client: httpx.AsyncClient`; `track_service(service: str)` async context manager; `close_http_client()`.
- `round_half_up(value: float | None, places: int = 1) -> float | None`; `heat_weight(feels_like_c: float | None) -> float`; `dose_weight(feels_like_c: float | None) -> float` (= `max(heat_weight, 0.1)`).
- `Point = tuple[float, float]` (lng, lat); `geohash_encode(lat, lng, precision) -> str`; `haversine_m(a: Point, b: Point) -> float`; `bearing_deg(a, b) -> float`; `sample_line(coords: list[Point], spacing_m: float) -> list[Point]`; `line_length_m(coords) -> float`; `interpolate(a, b, fraction) -> Point`.
- `sun_elevations(lat, lng, moments: list[datetime]) -> list[float]`.
- `save_file(key: str, content: bytes) -> None`; `local_path(key: str) -> Path` (sync; call with `asyncio.to_thread`).
- `record_service_result(service: str, error: str | None)`.

- [ ] **Step 1: `core/formulas.py`**

```python
from decimal import ROUND_HALF_UP, Decimal

COMFORT_LIMIT_C = 30
HOT_LIMIT_C = 40
WARM_RANGE_C = 10
HOT_STEP_C = 5
MIN_DOSE_WEIGHT = 0.1
FLOAT_NOISE_PLACES = 9


def round_half_up(value: float | None, places: int = 1) -> float | None:
    if value is None:
        return None
    # Round off float noise first, so 11.2499999999 still counts as 11.25
    cleaned = Decimal(str(round(value, FLOAT_NOISE_PLACES)))
    return float(cleaned.quantize(Decimal(1).scaleb(-places), rounding=ROUND_HALF_UP))


def heat_weight(feels_like_c: float | None) -> float:
    if feels_like_c is None:
        return 1.0
    if feels_like_c < COMFORT_LIMIT_C:
        return 0.0
    if feels_like_c < HOT_LIMIT_C:
        return (feels_like_c - COMFORT_LIMIT_C) / WARM_RANGE_C
    return 1 + (feels_like_c - HOT_LIMIT_C) / HOT_STEP_C


def dose_weight(feels_like_c: float | None) -> float:
    return max(heat_weight(feels_like_c), MIN_DOSE_WEIGHT)
```

- [ ] **Step 2: `core/geo.py`.** A pure-Python geohash (must match PostGIS `ST_GeoHash`), plus haversine, bearing and sampling:

```python
import math

Point = tuple[float, float]  # (lng, lat), same order as GeoJSON

EARTH_RADIUS_M = 6371008.8
GEOHASH_ALPHABET = "0123456789bcdefghjkmnpqrstuvwxyz"
BITS_PER_CHAR = 5


def geohash_encode(lat: float, lng: float, precision: int) -> str:
    lat_range, lng_range = [-90.0, 90.0], [-180.0, 180.0]
    chars, char_value, bit_count, use_lng = [], 0, 0, True
    while len(chars) < precision:
        value_range, value = (lng_range, lng) if use_lng else (lat_range, lat)
        middle = (value_range[0] + value_range[1]) / 2
        upper_half = value >= middle
        char_value = char_value * 2 + int(upper_half)
        value_range[0 if upper_half else 1] = middle
        use_lng, bit_count = not use_lng, bit_count + 1
        if bit_count == BITS_PER_CHAR:
            chars.append(GEOHASH_ALPHABET[char_value])
            char_value, bit_count = 0, 0
    return "".join(chars)


def haversine_m(a: Point, b: Point) -> float:
    lng1, lat1, lng2, lat2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lng2 - lng1) / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(h))


def bearing_deg(a: Point, b: Point) -> float:
    lng1, lat1, lng2, lat2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    x = math.sin(lng2 - lng1) * math.cos(lat2)
    y = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(lng2 - lng1)
    return (math.degrees(math.atan2(x, y)) + 360) % 360


def interpolate(a: Point, b: Point, fraction: float) -> Point:
    return (a[0] + (b[0] - a[0]) * fraction, a[1] + (b[1] - a[1]) * fraction)


def line_length_m(coords: list[Point]) -> float:
    return sum(haversine_m(a, b) for a, b in zip(coords, coords[1:]))


def sample_line(coords: list[Point], spacing_m: float) -> list[Point]:
    samples = [coords[0]]
    distance_to_next = spacing_m
    for a, b in zip(coords, coords[1:]):
        piece_m = haversine_m(a, b)
        position = distance_to_next
        while position <= piece_m:
            samples.append(interpolate(a, b, position / piece_m))
            position += spacing_m
        distance_to_next = position - piece_m
    return samples
```

- [ ] **Step 3: `core/sun.py`**

```python
from datetime import datetime

import pandas as pd
import pvlib


def sun_elevations(lat: float, lng: float, moments: list[datetime]) -> list[float]:
    positions = pvlib.solarposition.get_solarposition(pd.DatetimeIndex(moments), lat, lng)
    return positions["apparent_elevation"].tolist()
```

- [ ] **Step 4: `core/storage.py`**

```python
from pathlib import Path

import boto3

from app.config import settings

DATA_DIR = Path(__file__).resolve().parents[2] / ".data"
_s3 = boto3.client("s3", region_name=settings.aws_region) if settings.s3_bucket else None


def save_file(key: str, content: bytes) -> None:
    path = DATA_DIR / key
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    if _s3:
        _s3.put_object(Bucket=settings.s3_bucket, Key=key, Body=content)


def local_path(key: str) -> Path:
    path = DATA_DIR / key
    if path.exists() or not _s3:
        return path
    path.parent.mkdir(parents=True, exist_ok=True)
    _s3.download_file(settings.s3_bucket, key, str(path))
    return path
```

- [ ] **Step 5: `db/status_queries.py` + `core/http.py`**

```python
# db/status_queries.py
from app.db.pool import get_pool


async def record_service_result(service: str, error: str | None) -> None:
    if error is None:
        await get_pool().execute(
            "UPDATE service_status SET last_success_at = now() WHERE service = $1", service
        )
        return
    await get_pool().execute(
        "UPDATE service_status SET last_error_at = now(), last_error = $2 WHERE service = $1",
        service, error,
    )
```

```python
# core/http.py
from contextlib import asynccontextmanager

import httpx

from app.config import settings
from app.db.status_queries import record_service_result

http_client = httpx.AsyncClient(timeout=settings.outside_call_timeout_s)


def _describe_error(error: Exception) -> str:
    # Only the type and status: URLs can carry API keys
    if isinstance(error, httpx.HTTPStatusError):
        return f"HTTP {error.response.status_code}"
    return type(error).__name__


@asynccontextmanager
async def track_service(service: str):
    try:
        yield
    except Exception as error:
        await record_service_result(service, _describe_error(error))
        raise
    await record_service_result(service, None)


async def close_http_client() -> None:
    await http_client.aclose()
```

- [ ] **Step 6: Manual check.** Run in the venv:

```
python -c "from app.core.formulas import *; print(round_half_up(810/1.2/60), round_half_up((11.25+5)*dose_weight(44)), round_half_up((7.4+5)*dose_weight(41)))"
```

Expected: `11.3 29.3 14.9`.

```
docker exec -it <db container> psql -U sunskip -c "SELECT ST_GeoHash(ST_Point(75.56527, 26.84409), 7)"
python -c "from app.core.geo import geohash_encode; print(geohash_encode(26.84409, 75.56527, 7))"
```

Expected: both print the same 7 characters.

- [ ] **Step 7:** `ruff check .`, then commit `feat(api): shared formulas, geo, sun, storage, http helpers`.

---

### Task 3: `/meta`, `/health`, cleanup loop

**Files:** Modify `app/meta/router.py`, `app/health/router.py`, `app/db/status_queries.py`, `app/main.py`. Create `app/db/cleanup.py`.

- [ ] **Step 1: Queries** (add to `status_queries.py`):

```sql
-- imagery dates for /meta
SELECT min(imagery_date) AS min_date, max(imagery_date) AS max_date FROM shade_cells WHERE status = 'READY';

-- Solar calls this month (also used by the cost guard)
SELECT COALESCE((SELECT calls FROM solar_usage
  WHERE month_start = date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata')::date), 0) AS calls;

-- shade counts for /health
SELECT count(*) FILTER (WHERE status = 'READY')   AS cells_ready,
       count(*) FILTER (WHERE status = 'NO_DATA') AS cells_no_data
FROM shade_cells;
SELECT count(*) AS jobs_queued,
       COALESCE(EXTRACT(EPOCH FROM now() - min(created_at)), 0)::int AS oldest_queued_seconds
FROM shade_jobs WHERE status = 'QUEUED';

SELECT service, last_success_at, last_error_at FROM service_status;
```

Expose them as `get_imagery_dates()`, `get_solar_calls_this_month() -> int`, `get_shade_counts() -> dict`, `get_service_statuses() -> list[Record]`, plus `record_worker_heartbeat()` (`UPDATE service_status SET last_success_at = now() WHERE service = 'worker'`).

- [ ] **Step 2: `/meta`.** Returns the api.md §6.1 JSON: `shadeImageryDates` from the query (ISO dates or `null`), `shadeBudget.state = "EXHAUSTED" if calls >= settings.solar_monthly_call_budget else "OK"`, `representativeDay`, `heatAlertFeelsLikeC` from settings, `languages` and `modes` as constants in the file. Set `Cache-Control: public, max-age=3600`.
- [ ] **Step 3: `/health`.** It never calls a paid service.
  - `db`: run `SELECT 1`. On failure, return `503 INTERNAL_ERROR`.
  - `s3`: `"ok"` if no bucket is set or `head_bucket` succeeds (run with `asyncio.to_thread`), otherwise `"error"`.
  - Shade counts, `solarCallsThisMonth` and `solarBudget` from the queries; `workerLastSeenAt` is the `worker` row's `last_success_at`.
  - `services`: the 7 services, without `worker`.
  - `status` is `"degraded"` if any service has `last_error_at > last_success_at`, the worker hasn't been seen for 2 minutes, or `oldestQueuedSeconds > 300`. Otherwise `"ok"`. Both thresholds are named constants at the top of the file.
- [ ] **Step 4: `db/cleanup.py`.** Runs the 6 DELETEs from schema.md §6 every `cleanup_interval_s`. Each loop catches and logs errors, so one failure doesn't kill the loop. Wire it into `main.py`'s lifespan, as in Task 1 Step 10.
- [ ] **Step 5: Manual check.** `/v1/meta` returns budget `OK` and null dates. `/v1/health` returns `degraded`, because the worker isn't running yet. Stop the DB container → `/health` returns `503`.
- [ ] **Step 6:** Commit `feat(api): meta, health, cleanup`.

---

### Task 4: `/conditions`

**Files:** Create `app/conditions/weather.py`, `app/conditions/air.py`, `app/db/cache_queries.py`. Modify `app/conditions/router.py`.

**Interfaces (produces):** `get_conditions(location: LatLng, at: datetime) -> Conditions` (used by plan, best-time and the P2 agent); `feels_like_by_hour(conditions: Conditions) -> dict[datetime, float | None]` keyed by the start of the IST hour.

- [ ] **Step 1: Cache queries.** `read_cached(cell_id, kind, allow_expired: bool) -> dict | None` returns the `payload` when `expires_at > now()`, or, with `allow_expired`, when `fetched_at > now() - interval '24 hours'`. `write_cache(cell_id, kind, payload, source, ttl_minutes)` is an upsert on `(cell_id, kind)`. The cell id is `f"{lat:.2f}:{lng:.2f}"`.
- [ ] **Step 2: `weather.py`.** It decides which Open-Meteo source covers `at` (IST date):
  - **Forecast:** `today - 2 <= day <= today + 7`. Call `https://api.open-meteo.com/v1/forecast` with `latitude, longitude, hourly=temperature_2m,apparent_temperature, timezone=Asia/Kolkata, past_days=2, forecast_days=9`. Cache kind `WEATHER`, 15 min.
  - **Past:** older than that. Call `https://archive-api.open-meteo.com/v1/archive` for that exact day and the next one. Kind `WEATHER_ARCHIVE`, key `cell@YYYY-MM-DD`, `typical: false`.
  - **Far future:** beyond +7 days. Use the archive for the same day one year earlier, `typical: true`.
  - In every case, build `hourly` for the 24 hours from `at` floored to the hour.
  - On upstream failure, use the expired cache (`stale: true`). If there's no cache either, raise `ApiError(502, "UPSTREAM_ERROR", ...)`.
  - The 3 URLs and the day windows are constants at the top of the file.
- [ ] **Step 3: `air.py`.** Only when `|at - now| <= 1 h`. POST `https://airquality.googleapis.com/v1/currentConditions:lookup?key=...` with `{"location": {"latitude", "longitude"}, "extraComputations": ["LOCAL_AQI"], "universalAqi": false}`. Take the index with `code == "ind_cpcb"`, returning `(aqi, category)`. Cache kind `AIR`, 15 min. On failure return `(None, None)`: air quality never fails the banner.
- [ ] **Step 4: Router.** `GET /conditions?lat&lng&at` (`at` defaults to now in IST). `tempC` and `feelsLikeC` are the current hour's values, `heatAlert = feelsLikeC >= settings.heat_alert_feels_like_c`, and all values go through `round_half_up`.
- [ ] **Step 5: Manual check.**
  - `curl -H "X-Client-Id: t" "localhost:8000/v1/conditions?lat=26.84409&lng=75.56527"` → today's numbers plus a NAQI value.
  - `&at=2026-05-15T13:00:00%2B05:30` → `typical: false`, `naqi: null`, feels-like around the low 40s.
  - `&at=2027-05-15T13:00:00%2B05:30` → `typical: true`.
  - Call twice: the second call is fast (cache hit).
  - `/health` shows `open_meteo.lastSuccessAt`.
- [ ] **Step 6:** Commit `feat(api): conditions with weather + air caches`.

---

### Task 5: Shade queue (api side) + `/shade/jobs/{id}`

**Files:** Create `app/shade/queue.py`, `app/db/shade_queries.py`. Modify `app/shade/router.py`.

**Interfaces (produces):**
- `ensure_shade(area: dict, buffer_m: float, reason: str, client_hash: str | None) -> Shade`. `area` is a GeoJSON geometry (a MultiLineString of the walks, or a Polygon bbox). It never waits.
- `find_cells_and_areas(area: dict, buffer_m: float) -> tuple[list[str], list[str]]`.

- [ ] **Step 1: Gap query** (schema.md §10, parameterised):

```sql
WITH corr AS (SELECT ST_Buffer(ST_GeomFromGeoJSON($1)::geography, $2)::geometry AS c),
pts AS (SELECT ST_Centroid(sq.geom) AS p FROM corr, ST_SquareGrid(0.0003, corr.c) sq)
SELECT array_agg(DISTINCT ST_GeoHash(p, 7)) AS cells, array_agg(DISTINCT ST_GeoHash(p, 6)) AS osm_areas
FROM pts, corr WHERE ST_Intersects(p, c);
```

`ST_Buffer` with radius 0 returns the polygon itself, so a bbox works with `buffer_m = 0`. The grid step `0.0003` goes in a named constant in `shade_queries.py`.

- [ ] **Step 2: `ensure_shade` logic**, as small functions with early returns:
  1. `cells, areas = find_cells_and_areas(...)`. Load the statuses of both (`SELECT geohash, status FROM shade_cells WHERE geohash = ANY($1)`, and the same for `osm_areas`).
  2. `missing` = cells that are absent, `ERROR` or `BUDGET_EXCEEDED`. `in_progress` = `PENDING` or `FETCHING`. `missing_areas` = areas that are absent or `ERROR`.
  3. If nothing is missing or in progress: return `UNAVAILABLE` if every cell is `NO_DATA`, otherwise `READY`.
  4. If nothing is missing but some cells are in progress: find the active job (`SELECT id, cells, cells_done FROM shade_jobs WHERE status IN ('QUEUED','RUNNING') AND cells && $1 ORDER BY created_at DESC LIMIT 1`) and return `PREPARING` with it.
  5. If the budget is spent (`get_solar_calls_this_month() >= budget`), or the client's new cells today (`SELECT COALESCE(sum(cardinality(cells)),0) FROM shade_jobs WHERE client_hash = $1 AND created_at > now() - interval '1 day'`) plus `len(missing)` would go over the cap: return `UNAVAILABLE`.
  6. Otherwise, in one transaction, keeping the first `max_cells_per_job` missing cells:

```sql
INSERT INTO shade_cells (geohash, footprint)
SELECT h, ST_SetSRID(ST_Box2dFromGeoHash(h)::geometry, 4326) FROM unnest($1::text[]) h
ON CONFLICT (geohash) DO UPDATE SET status = 'PENDING', attempts = 0, last_error = NULL
WHERE shade_cells.status IN ('ERROR', 'BUDGET_EXCEEDED');

INSERT INTO osm_areas (geohash, footprint)
SELECT h, ST_SetSRID(ST_Box2dFromGeoHash(h)::geometry, 4326) FROM unnest($1::text[]) h
ON CONFLICT (geohash) DO UPDATE SET status = 'PENDING', attempts = 0 WHERE osm_areas.status = 'ERROR';

INSERT INTO shade_jobs (reason, client_hash, osm_areas, cells) VALUES ($1, $2, $3, $4) RETURNING id;
```

     Return `Shade(status="PREPARING", job_id=..., cells_total=len(cells), cells_done=0, poll_after_seconds=settings.poll_after_seconds)`.

- [ ] **Step 3: `GET /shade/jobs/{job_id}`.** Read the job (404 `NOT_FOUND` if missing or not a valid UUID) and return `ShadeJob`, with `cellsTotal = cardinality(cells)` and `readyToReplan = status == "DONE"`.
- [ ] **Step 4: Manual check.** From a Python shell in the venv, call `ensure_shade` on a short GeoJSON line at MUJ with buffer 100 → `PREPARING` plus a job id. In psql, `shade_cells` has about 12 `PENDING` rows and `shade_jobs` has 1 `QUEUED` row. Calling it again returns the same job (step 4 of the logic). `GET /v1/shade/jobs/<id>` shows `QUEUED`.
- [ ] **Step 5:** Commit `feat(api): on-demand shade queue and job status`.

---

### Task 6: Worker loop + Overpass (OSM walkways, stops, POIs)

**Files:** Create `app/worker/__main__.py`, `app/worker/job.py`, `app/worker/overpass.py`. Modify `app/db/shade_queries.py`.

**Interfaces (produces):** `load_osm_area(geohash6: str) -> None`; `run_job(job: Record) -> None`; queries `claim_next_job()`, `requeue_stuck_work()`, `finish_job(job_id, status, error)`.

- [ ] **Step 1: Queue queries.** Claim with the schema.md §10 `FOR UPDATE SKIP LOCKED` query. Requeue stuck work:

```sql
UPDATE shade_jobs SET status = 'QUEUED', started_at = NULL
WHERE status = 'RUNNING' AND started_at < now() - make_interval(mins => $1);
UPDATE shade_cells SET status = 'PENDING'
WHERE status = 'FETCHING' AND requested_at < now() - make_interval(mins => $1);
```

(`requested_at` is set to `now()` whenever a cell goes to `FETCHING`.) Finish: `UPDATE shade_jobs SET status = $2, error = $3, finished_at = now() WHERE id = $1`.

- [ ] **Step 2: `worker/__main__.py`**

```python
import asyncio
import logging

from app.config import settings
from app.db.pool import open_pool
from app.db.shade_queries import claim_next_job, requeue_stuck_work
from app.db.status_queries import record_worker_heartbeat
from app.worker.job import run_job

logger = logging.getLogger("worker")


async def beat_forever() -> None:
    while True:
        try:
            await record_worker_heartbeat()
            await requeue_stuck_work(settings.stuck_after_minutes)
        except Exception:
            logger.exception("Heartbeat failed")
        await asyncio.sleep(settings.heartbeat_interval_s)


async def run_worker() -> None:
    await open_pool(settings.worker_pool_size)
    heartbeat_task = asyncio.create_task(beat_forever())
    while True:
        job = await claim_next_job()
        if job is None:
            await asyncio.sleep(settings.worker_idle_sleep_s)
            continue
        await run_job(job)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(run_worker())
```

`heartbeat_task` is kept in a variable so the task isn't garbage-collected.

- [ ] **Step 3: `worker/job.py`**

```python
import logging

from app.db.shade_queries import finish_job
from app.worker.overpass import load_osm_area
from app.worker.scoring import score_cells
from app.worker.solar import fetch_cells

logger = logging.getLogger("worker")


async def run_job(job) -> None:
    logger.info("Job %s: %d areas, %d cells", job["id"], len(job["osm_areas"]), len(job["cells"]))
    try:
        for geohash6 in job["osm_areas"]:
            await load_osm_area(geohash6)
        await fetch_cells(job["id"], job["cells"])
        await score_cells(job["cells"])
    except Exception as error:
        logger.exception("Job %s failed", job["id"])
        await finish_job(job["id"], "FAILED", type(error).__name__)
        return
    await finish_job(job["id"], "DONE", None)
```

Until Tasks 7 and 8 exist, `job.py` imports only what's built. The other two calls are added in those tasks.

- [ ] **Step 4: `worker/overpass.py`.**
  - Skip the area if it's already `READY`; otherwise set it to `FETCHING`.
  - Get the bbox with `SELECT ST_YMin(f), ST_XMin(f), ST_YMax(f), ST_XMax(f) FROM osm_areas WHERE geohash = $1`.
  - POST the query below to `settings.overpass_url` inside `track_service("overpass")`, with a 60 s timeout. Overpass needs longer than 10 s; this is the one stated exception, kept as a named constant.
  - On 429, 406 or 504: wait 30 s and retry, up to 3 tries.
  - On final failure: `status = 'ERROR'`, `attempts + 1`, then raise.

```
[out:json][timeout:50];
(
  way["highway"~"^(footway|path|pedestrian|steps|living_street|residential|service|unclassified|track|cycleway|corridor|tertiary|tertiary_link|secondary|secondary_link|primary|primary_link)$"]["access"!~"^(private|no)$"]["foot"!~"^no$"]({bbox});
)->.walkways;
.walkways out geom;
(
  node["highway"="bus_stop"]({bbox});
  node["public_transport"="platform"]({bbox});
  node["railway"="station"]["station"="subway"]({bbox});
)->.stops;
.stops out;
(
  nwr["amenity"~"^(university|college|school|hospital|restaurant|cafe|fast_food)$"]({bbox});
  nwr["building"="dormitory"]({bbox});
  nwr["tourism"="hostel"]({bbox});
  nwr["shop"]({bbox});
  node["barrier"="gate"]({bbox});
)->.places;
.places out center;
```

- [ ] **Step 5: Turn ways into graph rows** (D3). This part needs a comment. Every pair of consecutive OSM nodes becomes one piece, and pieces over 50 m are cut into equal parts at new negative node ids:

```python
def split_point_id(way_id: int, split_index: int) -> int:
    # Negative ids never clash with real OSM node ids, and the same way always gets the same ids
    digest = hashlib.sha1(f"{way_id}:{split_index}".encode()).digest()
    return -(int.from_bytes(digest[:7], "big") + 1)


def way_to_segments(way: dict) -> tuple[list[tuple], list[tuple]]:
    nodes, segments, way_seq, split_index = [], [], 0, 0
    points = [(point["lon"], point["lat"]) for point in way["geometry"]]
    for (node_a, a), (node_b, b) in pairwise(zip(way["nodes"], points)):
        piece_m = haversine_m(a, b)
        if piece_m == 0:
            continue
        parts = math.ceil(piece_m / settings.max_segment_m)
        part_ids = [node_a]
        for part in range(1, parts):
            split_index += 1
            part_ids.append(split_point_id(way["id"], split_index))
            nodes.append((part_ids[-1], interpolate(a, b, part / parts)))
        part_ids.append(node_b)
        part_points = [interpolate(a, b, part / parts) for part in range(parts + 1)]
        for index in range(parts):
            segments.append((part_ids[index], part_ids[index + 1], way["id"], way_seq,
                             way["tags"]["highway"], way["tags"].get("name"),
                             part_points[index], part_points[index + 1], piece_m / parts))
            way_seq += 1
    nodes += list(zip(way["nodes"], points))
    return nodes, segments
```

  Split this into two functions if it goes over 40 lines when written. Inserts use `executemany`:
  - nodes: `INSERT INTO graph_nodes (id, geom) VALUES ($1, ST_Point($2, $3, 4326)) ON CONFLICT DO NOTHING`
  - segments: `... geom = ST_MakeLine(ST_Point($7,$8,4326), ST_Point($9,$10,4326)) ... ON CONFLICT (osm_way_id, way_seq) DO NOTHING`
  - stops: kind `METRO` for `station=subway`, otherwise `BUS`; `has_shelter = tags.get("shelter") == "yes"`; name falls back to `"Bus stop"`; `ON CONFLICT (osm_node_id) DO NOTHING`.
  - POIs: kinds mapped by tag. Weights come from a dict constant at the top of the file, marked as estimates: `HOSTEL 300, ACADEMIC 500, CAMPUS_GATE 400, STOP 200, FOOD 50, SHOP 30, OTHER 20`. `osm_id = f"{type}/{id}"`. For ways, use `center`.
  - Finally set the area to `status = 'READY'`, `fetched_at = now()`.
- [ ] **Step 6: Manual check.** With the Task 5 job still queued, run `python -m app.worker`. The log shows the job. In psql, `graph_nodes`, `segments`, `stops` and `pois` have rows and `osm_areas` is `READY`. `SELECT max(length_m) FROM segments` is ≤ 50. Re-run the same area (set it back to `PENDING` and queue a job) → row counts don't change. The job ends `DONE`, since Solar and scoring aren't wired yet.
- [ ] **Step 7:** Commit `feat(worker): job loop and OSM loading`.

---

### Task 7: Google Solar fetch + storage

**Files:** Create `app/worker/solar.py`. Modify `app/worker/job.py`, `app/db/shade_queries.py`.

**Interfaces (produces):** `fetch_cells(job_id, cells: list[str]) -> None`. Files land at `shade/{geohash}/month_{MM}.tif` and `shade/{geohash}/dsm.tif`.

- [ ] **Step 1: Per-cell flow** (`fetch_cell(geohash)`), run 4 at a time through an `asyncio.Semaphore(settings.worker_solar_concurrency)`:
  1. Skip it if the status isn't `PENDING`. Otherwise set `FETCHING` and `requested_at = now()`.
  2. Count the call against the budget (schema.md §10 query). If the returned `calls > budget`, set `BUDGET_EXCEEDED` and stop.
  3. Find the cell centre (`ST_Y(ST_Centroid(footprint)), ST_X(...)`). GET `https://solar.googleapis.com/v1/dataLayers:get` with `location.latitude, location.longitude, radiusMeters=100, view=FULL_LAYERS, requiredQuality=BASE, pixelSizeMeters=1, key`, inside `track_service("google_solar")`. A 404 means `NO_DATA`.
  4. Download `hourlyShadeUrls[0..11]` and `dsmUrl` with `&key=...` added, all at once (the links expire in about 1 h). Save each through `asyncio.to_thread(save_file, key, content)`.
  5. Set `READY`, with `imagery_date` from `imageryDate {year, month, day}`, `imagery_quality`, `s3_prefix = f"shade/{geohash}/"` and `ready_at = now()`.
  6. On any other error: `attempts + 1` and `last_error` = the error type. After 3 attempts, set `ERROR`; otherwise go back to `PENDING` and retry within the same job.
  7. After each cell: `UPDATE shade_jobs SET cells_done = cells_done + 1, cells_no_data = cells_no_data + $2 WHERE id = $1`.
- [ ] **Step 2: Manual check.** Queue the MUJ corridor again and run the worker. About 12 cells become `READY` with `imagery_date = 2025-04-19`, and `api/.data/shade/<hash>/` holds 13 files. Open one in Python: `rasterio.open(path).count == 24`, and the dtype is a 32-bit integer. `solar_usage.calls` has gone up by the number of calls. `/v1/shade/jobs/<id>` shows `cellsDone` climbing while it runs.
- [ ] **Step 3:** Commit `feat(worker): fetch Google Solar shade tiles`.

---

### Task 8: Scoring (segment_shade, stop_shade, shade_ready)

**Files:** Create `app/worker/scoring.py`. Modify `app/worker/job.py`, `app/db/shade_queries.py`.

**Interfaces (produces):** `score_cells(cells: list[str]) -> None`. After it runs, `segment_shade` rows exist for every newly ready segment (month 1–12, hours with sun ≥ 5°), and `segments.shade_ready = true`.

- [ ] **Step 1: Load the work.**
  - Segments not yet ready that touch the job's cells: `SELECT s.id, ST_AsGeoJSON(s.geom)::json FROM segments s WHERE NOT s.shade_ready AND EXISTS (SELECT 1 FROM shade_cells c WHERE c.geohash = ANY($1) AND ST_Intersects(c.footprint, s.geom))`.
  - Stops in those cells: the same query on `stops`.
- [ ] **Step 2: Sample.** For each segment, take `sample_line(coords, settings.shade_sample_spacing_m)`. Each point's cell is `geohash_encode(lat, lng, 7)`. Load the statuses of all those cells. A segment is ready only if every point's cell is `READY` or `NO_DATA`; skip the others. For stops, use a 3 × 3 grid of points 2.5 m apart around the stop (a named constant).
- [ ] **Step 3: Read the Solar bits.** This is the one place that needs a comment:

```python
def read_sun_bits(geohash: str, month: int, points: list[Point]) -> np.ndarray:
    """Returns (len(points), 24) of 1 = sun, 0 = shade, -1 = no data, for the representative day."""
    with rasterio.open(local_path(f"shade/{geohash}/month_{month:02d}.tif")) as tile:
        to_tile = Transformer.from_crs("EPSG:4326", tile.crs, always_xy=True)
        xs, ys = to_tile.transform([p[0] for p in points], [p[1] for p in points])
        values = np.ma.array(list(tile.sample(zip(xs, ys), masked=True)))
    # Careful: in Solar's data a set bit means SUN. Bit (day - 1) is that day of the month
    sun = ((values.astype(np.uint32) >> (settings.representative_day - 1)) & 1).astype(np.int8)
    return np.where(np.ma.getmaskarray(values), -1, sun)
```

  Points in `NO_DATA` cells get `-1` for every hour without opening a file. `local_path` is synchronous, so all the reading for a job runs inside one `asyncio.to_thread(...)`.
- [ ] **Step 4: Aggregate.**
  - Compute sun elevations once per job at the centre of the first cell, for day `representative_day` of each month at `hour:00` IST (288 moments, one `sun_elevations` call).
  - For each segment, month and hour with elevation ≥ `min_sun_elevation_deg`: `sun_fraction = sun points / points with data` (0 if there are none), and `nodata_fraction = no-data points / all points`.
  - Write `DELETE FROM segment_shade WHERE segment_id = ANY($1)`, then `copy_records_to_table("segment_shade", ...)`, then `UPDATE segments SET shade_ready = true WHERE id = ANY($1)`, in one transaction.
  - Stops work the same way into `stop_shade`; points without data are skipped, and a stop with no data gets no rows.
- [ ] **Step 5: Manual check.** After the MUJ job: `SELECT count(*) FROM segments WHERE shade_ready` > 0. Pick a segment on the pilot path (from the Bus 26 coordinates) and check `SELECT hour, sun_fraction FROM segment_shade WHERE segment_id = <id> AND month = 5 ORDER BY hour` → about 1.0 for hours 10–13 and lower at 7 and 18. No rows for hours 0–5 or 19–23.
- [ ] **Step 6:** Commit `feat(worker): score segment and stop shade`.

---

### Task 9: Preload script (MUJ + Jaipur metro)

**Files:** Create `scripts/preload.py`.

- [ ] **Step 1:** `python -m scripts.preload --area muj|jaipur-metro`.
  - **muj:** a circle (a GeoJSON Polygon built with shapely and a local metre projection) of a named radius around the pilot start (26.84409, 75.56527), large enough to include the Bus 26 stop (from your answer to question 1).
  - **jaipur-metro:** ask Overpass for `node["railway"="station"]["station"="subway"]` inside a Jaipur bbox constant, then a 500 m circle around each station.
  - For each circle: `find_cells_and_areas(circle, 0)`, then insert jobs with `reason = 'PRELOAD'` in chunks of at most `max_cells_per_job` cells, using the same insert functions as `ensure_shade` (DRY: move the "insert cells + areas + job" step into one function in `shade/queue.py` that both use).
  - Print the job ids and the total cells. If the total plus this month's calls would go over the budget, print that and stop without queuing anything.
- [ ] **Step 2: Manual check.** Run `--area muj` with the worker running. All jobs end `DONE`, and `/v1/health` shows `cellsReady` going up. Run `--area jaipur-metro` and check the cell count it prints is roughly 9 stations × 50 before it queues. It's fine to let that run overnight.
- [ ] **Step 3:** Commit `feat(api): preload script for demo areas`.

---

### Task 10: Google Routes client + cache

**Files:** Create `app/routes/google.py`, `app/routes/legs.py`. Modify `app/db/cache_queries.py`.

**Interfaces (produces):**
- `compute_routes(origin: PlaceInput, destination: PlaceInput, depart_at: datetime, travel_mode: str) -> list[dict]` (raw Google routes; `[]` if none).
- `google_departure_time(depart_at: datetime) -> datetime` (D5).
- `parse_route(route: dict, depart_at: datetime, time_shift: timedelta) -> tuple[list[Leg], int | None]`, giving the legs and Google's fare in rupees.

- [ ] **Step 1: `google_departure_time`.** If `depart_at` is in the future, return it unchanged. Otherwise add whole weeks until it's after now. The caller shifts every Google time by `depart_at - google_time`.
- [ ] **Step 2: `compute_routes`.**
  - **Cache key:** sha256 of the JSON `{origin, destination, mode, departAt floored to 15 min}`, with points at 5 decimals. `read_routes_cache(key)` / `write_routes_cache(key, response)`.
  - **Request:** POST `https://routes.googleapis.com/directions/v2:computeRoutes` with headers `X-Goog-Api-Key` and `X-Goog-FieldMask`. The field mask goes in a constant:
    `routes.duration,routes.distanceMeters,routes.travelAdvisory.transitFare,routes.legs.steps.travelMode,routes.legs.steps.distanceMeters,routes.legs.steps.staticDuration,routes.legs.steps.polyline,routes.legs.steps.startLocation,routes.legs.steps.endLocation,routes.legs.steps.transitDetails`
  - **Body:** `origin` / `destination` are `{"location": {"latLng": {...}}}` or `{"address": query}`. Also `travelMode`, `departureTime` (UTC `Z`), `computeAlternativeRoutes: true` (TRANSIT only), `languageCode: "en"`, `regionCode: "IN"`, `polylineEncoding: "GEO_JSON_LINESTRING"`.
  - Wrapped in `track_service("google_routes")`.
- [ ] **Step 3: `parse_route`.** Times come from Google, shifted by D5.
  - Consecutive WALK steps join into one WALK leg: polyline coordinates concatenated, distances and durations summed.
  - Each TRANSIT step becomes one leg:
    - `mode` mapped from `transitLine.vehicle.type` using the table in api.md §6.5 step 4 (a dict constant);
    - `line = {shortName: nameShort, name, vehicle, headwaySeconds}` (from `headway`, e.g. `"600s"`);
    - `from`/`to` from `stopDetails.departureStop` / `arrivalStop`;
    - times from `stopDetails.departureTime` / `arrivalTime`.
  - Walk leg `start_at` is the previous leg's `end_at` (or `depart_at` for the first), and `end_at = start_at + duration`.
  - Fare: `travelAdvisory.transitFare` `{currencyCode, units}` → `int(units)` when the currency is INR, otherwise `None`.
  - Remove duplicate routes: two routes are the same when their sequence of `(mode, line shortName)` matches.
- [ ] **Step 4: Manual check.** In a Python shell, `compute_routes` from MUJ to `{"query": "Mansarovar Metro Station, Jaipur"}` with TRANSIT returns 1 or more routes, or `[]` if Google has no transit there. Write down which; it decides the demo route. WALK from the pilot start to the Bus 26 stop gives a single route of about 810 m. A second call is a cache hit.
- [ ] **Step 5:** Commit `feat(api): Google Routes client with cache`.

---

### Task 11: Shadiest walk + exposure

**Files:** Create `app/routes/walk.py`, `app/routes/exposure.py`. Modify `app/db/shade_queries.py`.

**Interfaces (produces):**
- `WalkPath` dataclass: `segment_ids: list[int]`, `coords: list[Point]`, `pieces: list[tuple[int, float]]` (segment id and length, in walking order), `length_m: float`, `nodata_m: float`, `sun: SunLookup` (the shade rows loaded with the corridor, so exposure needs no second query).
- `find_shadiest_path(google_coords: list[Point], start_at: datetime, feels_like: dict) -> WalkPath | None`.
- `SunLookup = dict[tuple[int, int], tuple[float, float]]`, mapping `(segment_id, hour)` to `(sun_fraction, nodata_fraction)` for the trip's month. It's built from the corridor query and reused for every slot in best-time. A missing key means the sun is below 5°, so the sun fraction is 0.
- `walk_exposure(path: WalkPath, start_at: datetime, feels_like: dict) -> tuple[Exposure, dict[datetime, float]]`, returning the exposure plus sun minutes per hour (for the dose).
- `option_exposure(walks: list[tuple[Exposure, dict]], waits: list[tuple[float | None, datetime]], feels_like: dict) -> Exposure`.

- [ ] **Step 1: Corridor load** (one query):

```sql
SELECT s.id, s.from_node, s.to_node, s.length_m, ST_AsGeoJSON(s.geom)::json AS geometry,
       sh.hour, sh.sun_fraction, sh.nodata_fraction
FROM segments s
LEFT JOIN segment_shade sh ON sh.segment_id = s.id AND sh.month = $3
WHERE s.shade_ready
  AND ST_Intersects(s.geom, ST_Buffer(ST_GeomFromGeoJSON($1)::geography, $2)::geometry);
```

- [ ] **Step 2: Graph and path** (D4).
  - Build an `nx.Graph`, keeping the shorter edge when two segments join the same nodes. Snap the walk's start and end to the nearest loaded node, using `haversine_m` over the loaded nodes. If either is further than `graph_snap_max_m`, return `None`.
  - Edge cost:

```python
def edge_cost(length_m: float, sun_fraction: float, weight: float) -> float:
    return length_m * (1 + settings.shade_alpha * sun_fraction * weight)
```

    using `sun_fraction` at the start hour (`0` when there's no row, because the sun is below 5°) and `heat_weight(feels_like at the start hour)`.
  - Compute the shortest path by `length_m` and the shadiest by cost, with `nx.shortest_path(..., weight=callable)`. Use the shadiest if its length is ≤ `max_detour_ratio` × the shortest's, otherwise the shortest.
  - Build `coords` by joining the segment geometries in walking order, reversing a segment when it's walked against its stored direction. `nodata_m` is the length of segments whose `nodata_fraction` is 1 at the start hour.
- [ ] **Step 3: `walk_exposure`.** Walk the pieces in order, keeping a running distance:
  - The time at a piece's start is `start_at + distance / walk_speed_mps`, and its hour is that time's IST hour.
  - `sun_m += length × sun_fraction(segment, hour)`. Pieces with `nodata_fraction == 1` count as full sun.
  - A piece's sun minutes go to that hour's bucket. `sunMinutesHot` adds them only when feels-like at that hour ≥ `heat_alert_feels_like_c`.
  - `walkMinutes = length / speed / 60`.
  - `shadePct = 100 × (1 − sun_m / length)`.
  - `feelsLikeC` is the maximum feels-like over the hours walked.
  - Everything goes through `round_half_up`, except the hourly buckets, which stay raw for the dose.
- [ ] **Step 4: `option_exposure`.**
  - Sum the walks.
  - `waitSunMinutes`: per transit leg, 0 if the stop is shaded, `wait_s / 60` if unknown, otherwise `wait_s / 60 × the stop's sun_fraction`. Add each wait to the bucket of its hour.
  - `heatDose = Σ over hours of (bucket minutes × dose_weight(feels_like at that hour))`.
  - If any walk has unknown sun, `sunMinutes`, `sunMinutesHot`, `shadePct` and `heatDose` are `null`.
- [ ] **Step 5: Manual check.** From a Python shell, run `find_shadiest_path` with the Google WALK polyline from Task 10 (pilot start to Bus 26), start `2026-05-15T13:00+05:30`, and feels-like 44 for every hour. Expected: `length_m` within ±5% of 810, and `walk_exposure` gives `sunMinutes ≈ 11.3`, `shadePct ≈ 0`. At 17:00: `≈ 7.4`. If the numbers are off by more than 0.2 minutes, stop and look into it before continuing; it means the OSM path differs from Google's.
- [ ] **Step 6:** Commit `feat(api): shadiest walk path and exposure`.

---

### Task 12: `POST /routes/plan` + fakes

**Files:** Create `app/routes/ranking.py`, `app/routes/plan.py`, `app/contracts/fakes.py`, `app/db/trip_queries.py`. Modify `app/routes/router.py`, `app/db/shade_queries.py`.

**Interfaces (produces):**
- `plan_trip(request: PlanRequest, client_hash: str) -> PlanResponse` (also used by best-time and the agent).
- `rank_options(options: list[RouteOption], preference: float) -> list[RouteOption]`.
- `save_trip(trip_id, client_hash, request_json, options_json)`, `load_trip(trip_id) -> Record | None`, `log_route_request(...)`.

- [ ] **Step 1: `ranking.py`.**
  - Scale `d`, `c` and `h` to 0–1 with `(x − min) / (max − min)`, using 0 when `max == min`. An unknown value scales to 1.
  - `score = p·h + (1 − p)·(0.5·d + 0.5·c)`. The lowest score gets `RECOMMENDED`.
  - `FASTEST` goes to the minimum duration, `CHEAPEST` to the minimum known fare, `COOLEST` to the minimum known dose. Labels are added only when the value is known.
  - Sort with RECOMMENDED first, then by score. Give option ids `opt_1…` in final order.
- [ ] **Step 2: `plan.py` flow.** Each step is its own small function.
  1. `depart_at = request.depart_at or now(IST)`. Run `compute_routes` TRANSIT and WALK in parallel (`asyncio.gather`).
  2. If there are no transit routes and the walk route is longer than `walk_only_max_m` (or there's none): raise `ApiError(422, "NO_ROUTE_FOUND", ...)`. If Google fails: raise 502, unless a walk-only route is available, in which case use it.
  3. `conditions = get_conditions(origin point, depart_at)` and `feels_like = feels_like_by_hour(conditions)`. If weather fails, use an empty dict, so the heat weight falls back to 1.
  4. Parse the routes into legs, then call `ensure_shade(MultiLineString of all walk-leg polylines, corridor_buffer_m, "PLAN", client_hash)`. This doesn't wait.
  5. Score each WALK leg:
     - `path = find_shadiest_path(...)`.
     - If there's a path: replace the leg's polyline, distance and duration with ours, set `segment_ids`, `shade_known = true`, `coverage = "FULL"`, or `"PARTIAL"` if `nodata_m > 0`, and add the exposure.
     - If there's no path: `shade_known = false`, `coverage = "NONE"`, and an exposure with only walk metres and minutes.
  6. Score each transit leg:
     - `wait_seconds = headway / 2` or `default_wait_seconds`.
     - `stop_shaded`: match our stops within `stop_match_m`:

```sql
SELECT st.id, COALESCE(st.has_shelter OR ss.sun_fraction < 0.5, st.has_shelter) AS shaded, ss.sun_fraction
FROM stops st LEFT JOIN stop_shade ss ON ss.stop_id = st.id AND ss.month = $3 AND ss.hour = $4
WHERE ST_DWithin(st.geom::geography, ST_Point($1, $2, 4326)::geography, $5)
ORDER BY st.geom <-> ST_Point($1, $2, 4326) LIMIT 1;
```

       If nothing matches, `stop_shaded = null`.
     - Add the option's duration change from our walk path versus Google's walk.
  7. E-rickshaw swaps (Task 13) go here.
  8. Option exposure, then warnings:
     - `HEAT_ALERT` if feels-like ≥ the alert threshold;
     - `LONG_WAIT_IN_SUN` if `waitSunMinutes ≥ long_wait_in_sun_min`;
     - `SHADE_PREPARING` if shade is preparing and a walk is unknown;
     - `NO_SHADE_DATA` if shade is unavailable;
     - `NO_SHADE_DATA_PARTIAL` if any walk is `PARTIAL`.
     Then rank and keep the first `max_options`.
  9. Save the trip (`trips` with the request and options, including `segmentIds`). Log the request: `origin_rounded = ST_SnapToGrid(ST_Point($lng, $lat, 4326), $grid)`, `status = 'OK'`, top option, `top_segment_ids`, `latency_ms`. Return the `PlanResponse` with `exclude=LEG_INTERNALS`.
  - A failed request is logged with its error status and then re-raised.
- [ ] **Step 3: Fakes.** `contracts/fakes.py` has `fake_plan()`, `fake_best_time()` and `fake_conditions()`, returning the api.md §6 example JSON (810 m, 11.3 / 7.4, dose 29.3 / 14.9, Bus 26). The plan, best-time and conditions routers start with `if settings.use_fakes: return fake_...()`.
- [ ] **Step 4: Router.** `POST /routes/plan` calls `plan_trip(body, request.state.client_hash)`.
- [ ] **Step 5: Manual check.**
  - `curl -X POST -H "X-Client-Id: t" -H "Content-Type: application/json" localhost:8000/v1/routes/plan -d '{"origin":{"lat":26.84409,"lng":75.56527},"destination":{"lat":<bus26 lat>,"lng":<bus26 lng>},"departAt":"2026-05-15T13:00:00+05:30"}'` → a walk option with `sunMinutes: 11.3`, `shadePct` ≈ 0, `shade.status: READY`, and the response in under 3 s.
  - Plan a trip in a city we've never loaded (for example two points 600 m apart in Pune) → `PREPARING`, a `jobId`, `sunMinutes: null` and `SHADE_PREPARING`. Poll the job until `DONE`, then send the same plan again → `READY` with numbers.
  - The `trips` and `route_requests` rows exist, and the logged origin is rounded (`POINT(75.5655 26.844)`).
  - `USE_FAKES=true` returns the fake numbers.
- [ ] **Step 6:** Commit `feat(api): plan endpoint`.

---

### Task 13: E-rickshaw zones + swap

**Files:** Create `scripts/seed_zones.py`, `app/routes/erickshaw.py`. Modify `app/routes/plan.py`.

- [ ] **Step 1: `seed_zones.py`** (D9). It upserts on `name`:
  - `MUJ – Dehmi Kalan`: a circle of radius `MUJ_ZONE_RADIUS_M = 3000` around the pilot start;
  - each `METRO` stop in `stops` (`DISTINCT ON (name)`): a circle of `STATION_ZONE_RADIUS_M = 1500`, built with `ST_Buffer(geom::geography, r)::geometry`;
  - fares `BASE_FARE_INR = 10`, `PER_KM_INR = 10`, `fare_source = 'FORMULA'`.
- [ ] **Step 2: `erickshaw.py`.**
  - `find_zone(a: Point, b: Point) -> Record | None` is one query: `SELECT ... FROM erickshaw_zones WHERE active AND ST_Contains(geom, ST_Point($1,$2,4326)) AND ST_Contains(geom, ST_Point($3,$4,4326)) LIMIT 1`.
  - `swap_option(option) -> RouteOption | None` copies the option. Every WALK leg with `distance > swap_min_walk_m` or hot sun minutes > `swap_min_hot_sun_min`, and both ends in one zone, becomes an `ERICKSHAW` leg:
    - `duration = distance / erickshaw_speed_mps + erickshaw_wait_seconds`;
    - `fare = base + per_km × ceil(km)`;
    - `swapped_from = "WALK"`, `exposure = None`.
  - Later legs' times move by the time saved. The option fare becomes the transit fare plus the e-rickshaw fares (`null` if the transit fare is unknown and the option has transit legs), and the option gets the `FARE_ESTIMATED` warning. If no leg qualifies, return `None`.
  - Called from plan step 7, only when `allow_erickshaw` is true.
- [ ] **Step 3: Manual check.** After `--area jaipur-metro` and `seed_zones`, run a plan from 1.2 km away to a station inside one zone → an extra option with an `ERICKSHAW` leg, `FARE_ESTIMATED` and a fare. With `allowErickshaw: false` there's no swap option.
- [ ] **Step 4:** Commit `feat(api): e-rickshaw swap option`.

---

### Task 14: `POST /routes/best-time`

**Files:** Create `app/routes/best_time.py`. Modify `app/routes/router.py`.

- [ ] **Step 1: Flow.**
  - Check that `to` is after `from` and the window is at most 14 h (a constant); otherwise `400`.
  - Run `plan_trip` once at `date` + `from`, then take the RECOMMENDED option.
  - For each slot from `from` to `to` in `step_minutes` steps, re-score that option's walk paths with `walk_exposure` at the slot's start time (each walk leg keeps its offset from departure), and its waits with the same stop shade, both using that day's `feels_like`.
  - `basis = "SHADE"` when every walk has a path. Otherwise `"TEMPERATURE_ONLY"`: `sunMinutes = null`, and `heatDose = walkMinutes × dose_weight(feels_like)` only for slots where `sun_elevations` ≥ the minimum elevation (otherwise 0).
  - `best` is the slot with the lowest `sunMinutes` (or the lowest dose for TEMPERATURE_ONLY), with ties going to the earlier slot.
  - `note` is `"Bus times are not re-checked per slot."` (a constant).
  - There are no extra Google calls.
- [ ] **Step 2: Manual check.** Best-time for the pilot walk on `2026-05-15`, `07:00–19:00`, step 60 → 13:00 has `sunMinutes: 11.3`, 17:00 has `7.4`, and `best` is one of the shadier evening slots. The per-hour values match the PRD table (5.6, 8.5, 10.6, 11.3…, 4.4) within ±0.2.
- [ ] **Step 3:** Commit `feat(api): best time to leave`.

---

### Task 15: Waypoints, choice, `/shade/segments`

**Files:** Create `app/routes/waypoints.py`. Modify `app/routes/router.py`, `app/shade/router.py`, `app/db/trip_queries.py`, `app/db/shade_queries.py`.

- [ ] **Step 1: Waypoints.**
  - Load the trip (`404` if it's missing or expired) and the option (`404` if unknown).
  - Each WALK leg's `polyline` coords become `sample_line(coords, waypoint_spacing_m)`. Track `distanceFromStartM` across legs, and set `bearingDeg` to the bearing towards the next point.
  - `inSun`: find the segment under the point by walking `segment_ids` in order with a running length. It's `sun_fraction ≥ 0.5` at the expected time, or `null` when the leg has no `segment_ids`.
  - `cue`:
    - at each leg start: `"Head {compass} along {segment name or 'the path'}"`;
    - where the bearing changes by ≥ 30° from the previous waypoint: `"Turn left"` / `"Turn right"`.
    The compass names and the 30° value are constants.
- [ ] **Step 2: Choice.** `POST /routes/{trip_id}/choice`.
  - `404` if the trip or option is unknown.
  - Upsert `route_choices (trip_id, option_id, labels, sun_minutes, segment_ids)` with `ON CONFLICT (trip_id) DO UPDATE`.
  - Return `204`.
- [ ] **Step 3: `/shade/segments?bbox=w,s,e,n&month&hour`.**
  - Check the bbox is ≤ `max_shade_map_km2` (area from `line_length_m` of its sides); otherwise `400`.
  - `shade = ensure_shade(bbox polygon, 0, "MAP", client_hash)`.
  - Features come from the schema.md §10 shade-map query, adding `s.stretch_id`. `id` is `f"seg_{id}"`, and `stretchId` is `f"str_{id:03d}"` or `null`.
  - `Cache-Control` is `public, max-age=86400` when `READY`, otherwise `no-store`.
- [ ] **Step 4: Manual check.**
  - Waypoints for the pilot trip → a point every 25 m, the first with a cue, `inSun: true` at 13:00.
  - Choice → `204`, and the row exists. Posting again with a different option updates it.
  - The shade map over MUJ at month 5, hour 12 → features with `sunFraction` ≈ 1 on the pilot path. A bbox over Pune → `PREPARING`.
- [ ] **Step 5:** Commit `feat(api): waypoints, choice, shade map`.

---

### Task 16: End-to-end pilot check + doc sync

- [ ] **Step 1:** Restart everything clean (`docker compose -f docker-compose.dev.yml down -v`, then migrate, preload MUJ, wait for `DONE`). Then check by hand:
  - **Plan** at 13:00 → walk 810 m ±5%, `sunMinutes 11.3`.
  - **Best-time** → 13:00 is `11.3` and 17:00 is `7.4`.
  - **Dose** with a 5-minute wait at feels-like 44 is `29.3`.
  - **Speed:** plan responds in under 3 s and best-time in under 6 s (`curl -w "%{time_total}"`).
  - **`/health`** is `ok` with the worker running.
- [ ] **Step 2:** Re-read api.md §6 and schema.md against what was built. Fix any doc drift (rule 9: docs describe the code). Commit `docs: sync api and schema with backend`.
- [ ] **Step 3:** Build and run with `docker compose up -d --build` (api + worker), and confirm the same checks pass inside Docker.
