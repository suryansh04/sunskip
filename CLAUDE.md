# SunSkip

Walking + transit routes with the least direct sun, anywhere in India (student app), and a portal that shows city officials where trees and shelters would help most. Hackathon build. **Deadline: Sun 11 Oct 2026, 23:59 IST. Feature freeze Sun 14:00.**

## Read first

The docs in `docs/` are a **reference, not a contract to follow line by line** (see rule 9). Read the relevant one before writing code:

- `docs/PRD.md`: what we build and why
- `docs/TRD.md`: stack, allowed packages, code rules, setup, deploy
- `docs/api.md`: the 18 endpoints, data shapes, formulas
- `docs/schema.md`: every table and the `0001_init` SQL
- `docs/design.md`: colours, font, icons, map style and every app screen
- `README.md`: what SunSkip is, how it's built, and how to set it up locally

If the code and the docs disagree, stop and ask. Don't guess. Keep the docs updated so they always describe what the code actually does.

## Team rules (everyone follows these)

1. **As simple as possible.** Write the most direct code that works. No abstractions "for later", no generic helpers for one use, no config for things that never change.
2. **Clean code.** Clear names, small functions, consistent formatting. Code should read without comments (see rule 10).
3. **No dead code.** No commented-out code, unused imports, unused functions, unused files or leftover `console.log` / `print`. Delete it; git remembers.
4. **No test files.** Don't write unit, integration or e2e tests. Test manually: run the endpoint with `curl` or the FastAPI `/docs` page, click through the screen in the browser, and check it on a phone.
5. **DRY.** Don't repeat logic. If the same code appears a second time in the same project, move it into one function and reuse it. The one allowed exception: `types.ts`, `api/client.ts`, `MapView.tsx` and the fixtures are copied between `app/` and `portal/` (TRD §2.6), and both copies change in the same commit.
6. **Ask before changing a contract.** Before you change the **database schema**, the **API design**, or **any endpoint** (path, request, response, status codes, errors):
   1. ask the user and explain what changes and why;
   2. wait for approval;
   3. update the docs (`schema.md`, `api.md`, `TRD.md`, and fixtures if a shape changes);
   4. only then commit and push.
7. **Minimal folder structure.** Use the layout below. Don't add new top-level folders, `utils/` dumping grounds or nested folders with one file. Ask before adding a folder.
8. **Don't overcomplicate. Ask when unsure.** If a task is unclear or there are two reasonable ways to do it, ask a question instead of guessing.
9. **The docs are a reference, not a compulsion.** If something in `PRD.md`, `TRD.md`, `api.md` or `schema.md` is too complicated for what it gives us, drop it or replace it with something simpler. Say what you removed and why, and update the doc to match. If the change touches the schema, the API or an endpoint, rule 6 still applies: ask first.
10. **Comments only where the code is complex.** Not in every file and not on every function. Add one only where someone would get stuck, like a formula, a tricky SQL query, or a workaround. Keep it short, in plain simple words, the way you'd explain it to a teammate.
    - Good: `# Careful: in Solar's data a 1 means sun, not shade`
    - Bad: `# This function iterates over the segments and computes the sun fraction value`
11. **No magic numbers.** Every tunable value lives in `api/app/config.py`, named as in api.md §11 and schema.md §8. Write `settings.walk_speed_mps`, never a bare `1.2`. Front-end constants (colours, heat alert threshold) go at the top of the file that uses them, or come from `/meta`.
12. **Small functions and files.** Aim for functions under ~40 lines and files under ~300 lines. When one gets bigger, split it by what each part does.
13. **Early returns.** Handle the bad case first and return, so the normal path stays flat. No deep `if` nesting.
14. **Names say what it does.** Functions are verbs that describe the action (`fetch_solar_tile`, `compute_sun_minutes`, `fetchConditions`). Variables say what they hold, with units where it matters (`walk_meters`, `wait_seconds`, `sun_fraction`). No `data2`, `tmp`, `res2`, `x` or unclear abbreviations. Use the same words as api.md.
15. **Type hints in Python.** Every function has typed parameters and a return type (`def compute_sun_minutes(segments: list[Segment], depart_at: datetime) -> float | None:`).

## Folder structure

```
sunskip_app/
├── CLAUDE.md
├── README.md              what it is, architecture, local setup
├── docs/                  PRD.md  TRD.md  api.md  schema.md  design.md  plans/
├── .github/workflows/     ci.yml (ruff for api, npm build for app; add a portal job once portal/ exists)
├── .gitignore
│
├── api/                   FastAPI + worker (Python 3.12)
│   ├── app/
│   │   ├── main.py            creates the app, adds middleware, includes all routers
│   │   ├── config.py          all settings + secrets
│   │   ├── core/              errors, middleware, http (shared client), formulas, geo, sun, storage
│   │   ├── contracts/         models.py (Pydantic shapes), ids.py (seg_/str_ ids), fakes.py
│   │   ├── db/                pool.py, *_queries.py, cleanup.py
│   │   ├── meta/              router.py
│   │   ├── conditions/        router.py, report.py, weather.py, air.py
│   │   ├── shade/             router.py, queue.py, segments.py, tiles.py, bbox.py
│   │   ├── routes/            router.py, plan.py, google.py, legs.py, options.py, walk.py, exposure.py, ranking.py,
│   │   │                      erickshaw.py, best_time.py, waypoints.py
│   │   ├── portal/            router.py, reports.py, recommendations.py, simulate.py
│   │   ├── health/            router.py
│   │   ├── agent/             router.py, ...           (P2)
│   │   ├── voice/             router.py, sarvam.py     (P2)
│   │   └── worker/            __main__.py, job.py, overpass.py, solar.py, scoring.py, stretches.py, demand.py
│   ├── migrations/            0001_init.sql, ...
│   ├── scripts/               migrate.py, preload.py, seed_zones.py
│   ├── requirements.txt  Dockerfile  docker-compose.yml  docker-compose.dev.yml
│   └── .env.example
│
├── app/                   student app (Vite + React, phone-first PWA)
│   ├── README.md              how to run the app, mocks, phone testing
│   ├── public/                favicon.svg (logo master), favicon.ico, app icons
│   ├── src/
│   │   ├── main.tsx  index.css  types.ts
│   │   ├── api/               client.ts, fixtures/, walk.ts, useShadeJob.ts
│   │   ├── components/        MapView, RouteCard, HeatBanner, ...
│   │   ├── pages/             Home, Results, BestTime, ShadeMap
│   │   └── features/          agent/ (P2), voice/ (P2), ar/ (P3)
│   └── index.html  package.json  vite.config.ts  tsconfig.json  .env.example
│
└── portal/                officials portal (Vite + React, desktop, Cognito login)
    ├── src/
    │   ├── main.tsx  index.css  types.ts  auth.ts
    │   ├── api/               client.ts, fixtures/
    │   ├── components/        MapView, StretchList, HourGrid, ...
    │   └── pages/             Login, Callback, HeatPain, Recommendations, Stretch, Simulate, Stats
    └── index.html  package.json  vite.config.ts  tsconfig.json  .env.example
```

The file names inside the feature folders are a starting point. Create a file only when you need it.

**API feature folders:**
- `router.py` holds only the endpoints: read the request, call a logic function, return the response. No SQL and no business logic in it.
- Logic lives in plain functions. Keep it in `router.py`'s folder in one file named after what it does (`plan.py`, `weather.py`); split into more files only when it gets big (rule 12).
- Logic functions don't know about HTTP, so the agent tools (P2) can call the same functions as the endpoints.
- SQL lives in `db/*_queries.py` (plain SQL through the `asyncpg` pool, no ORM). Schema changes are new files in `api/migrations/`.

**Ownership:** P1 (Suryansh) owns `api/` and `portal/` and is the only one who writes migrations. P3 builds the whole student app in `app/`, including `app/src/features/ar`, following `docs/design.md`. P2 works in `api/app/agent`, `api/app/voice`, `app/src/features/agent`, `app/src/features/voice`. Ask before editing outside your area.

## Front end (`app/`, `portal/`)

- Only the packages listed in TRD §2.1. No Redux/Zustand/Context/TanStack Query, no UI kits, no chart libraries, no form libraries, no react-map-gl or deck.gl.
- `.tsx` files, `strict: false`. Types live only in `src/types.ts`; `any` is fine elsewhere.
- Hooks: only `useState`, `useEffect`, `useRef`. No `useMemo`/`useCallback` unless a bug forces it.
- One component per file, default export, destructured props.
- Data fetching uses the single pattern in TRD §2.3 (axios `api` client, `data`/`loading`/`error` state).
- Every screen has loading, error and empty states.
- Tailwind only for styling. Colours, font, icons and the map style are in `docs/design.md` (core colours: shade `#2F80ED`, sun `#F2994A`, alert `#B91C1C`).
- App is mobile-first (360 px, one column, `py-3` tap targets). Portal is desktop-first (1280 px+).

## Backend (`api/`)

- Async everywhere; one shared `httpx.AsyncClient`.
- Pydantic v2 with camelCase JSON (`alias_generator=to_camel`, `populate_by_name=True`); Python stays snake_case.
- Every outside call: 10 s timeout, updates `service_status`, never logs keys or request bodies.
- Errors always use `{ "error": { "code", "message", "requestId" } }` with the codes in api.md §3.
- Every request finishes in under 29 s. Never make a request wait for shade data; return `PREPARING` + `jobId`.
- `ruff` must pass. It also checks type hints (rule 15).

## Product rules (never break these)

- **Never invent numbers.** Every number comes from data or an api.md formula. Label estimates as estimates.
- **Unknown is `null`, never `0`.** The UI shows `null` as "unknown".
- **Round half up** (11.25 → 11.3). Python's `round()` is wrong here.
- **Never write "safe"** in UI text or agent replies. No medical advice.
- **Privacy:** store only hashed client ids; logged locations rounded to ~50 m.
- **No secrets in the repo** or in `VITE_*` variables. Keys live in AWS Secrets Manager; `.env` is git-ignored.

## Running locally

```bash
# database
cd api && docker compose -f docker-compose.dev.yml up -d --wait && python -m scripts.migrate
# api (USE_FAKES=true returns the real Bus 26 numbers: 810 m, 11.3 / 7.4 min)
uvicorn app.main:app --reload
# worker
python -m app.worker
# front ends (VITE_USE_MOCKS=true until the API is up)
cd app && npm run dev        # http://localhost:5173
cd portal && npm run dev     # http://localhost:5174
```

Before pushing: `ruff check` (api) and `npm run build` (app, portal) must pass, and you've checked the change by hand.

## Git

- Branch per task from `main`; small, focused commits with clear messages.
- Never commit `.env`, keys, `node_modules`, `dist` or `__pycache__`.
