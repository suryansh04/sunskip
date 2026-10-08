# SunSkip: Technical Requirements (v1)

> **SunSkip: Skip the sun, not the trip.**
>
> - **What this file covers:** how we build it (stack, folders, code rules, setup, deploy).
> - **Other docs:** what we build is in `PRD.md`; the endpoint contract is in `api.md`; the database is in `schema.md`; who builds what and when is in `SunSkip_Team_Handbook.pdf`.
> - **Deadline:** Sun 11 Oct 2026, 23:59 IST. Feature freeze Sun 14:00.
> - **Versions:** all versions below were checked on npm/PyPI on 8 Oct 2026.
> - **Tested:** the front-end setup builds (`tsc -b && vite build`); the back-end requirements install on Python 3.12, and both the api and worker entry points start.

---

## 1. System at a glance

```
sunskip-app (React, phone)  ─┐
                             ├─ HTTPS ─> API Gateway (HTTP API) ─> EC2: Docker [api] [worker]
sunskip-portal (React, desk) ─┘          adds X-Origin-Secret          │      │
                                         checks Cognito on /portal/*   │      │
                                                                       ▼      ▼
                                              RDS PostgreSQL + PostGIS · S3 · Secrets Manager
api    → Google Routes, Google Air Quality, Open-Meteo, Claude API, Sarvam
worker → Google Solar (shade), Overpass (OpenStreetMap)
```

**One repo (monorepo), three folders.** The app and the portal are separate front ends that call the same backend.

| Part                           | Owner                                                     | Folder                             |
| ------------------------------ | --------------------------------------------------------- | ---------------------------------- |
| API + worker + infra           | Suryansh (P1)                                             | `api/`                             |
| Student app                    | Suryansh (P1); chat/voice components by P2; AR view by P3 | `app/`                             |
| Officials portal               | Suryansh (P1)                                             | `portal/`                          |
| Agent + voice (inside the API) | Person 2                                                  | `api/app/agent`, `api/app/voice`   |

---

## 2. Front-end rules (app and portal)

**Style decision:** files are `.tsx`, but the code reads like plain React JSX.

### 2.1 Allowed

| Use            | Package (pinned major)                                                                                                        |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Build tool     | `vite@7` + `@vitejs/plugin-react@5`                                                                                           |
| UI             | `react@19`, `react-dom@19`                                                                                                    |
| Language       | `typescript@5.9` (**not 7**), `strict: false`                                                                                 |
| Styling        | `tailwindcss@4` + `@tailwindcss/vite@4`                                                                                       |
| Pages          | `react-router@7`, using `BrowserRouter`, `Routes`, `Route`, `Link`, `useNavigate`, `useParams` imported from `"react-router"` |
| HTTP           | `axios@1` (one shared client)                                                                                                 |
| Map            | `maplibre-gl@5`, used directly inside `useEffect`                                                                             |
| Install as app | `vite-plugin-pwa@1` (app only)                                                                                                |
| AR (P3 only)   | `locar@0.2.12` (exact) + `three@0.181.x`                                                                                      |

> **Why these versions:** newer majors exist (Vite 8, React Router 8, TypeScript 7), but they are new and less documented. Stay on the lines above. LocAR needs `three` 0.181.x exactly.

### 2.2 Not allowed (keep it simple)

- No Redux, Zustand, React Context or TanStack Query.
- No form libraries.
- No UI kits (MUI, shadcn and similar).
- No chart libraries: bars are `div`s with a Tailwind width, and grids are CSS grid.
- No react-map-gl and no deck.gl.
- No custom hook files unless the same code appears 3+ times.
- No `useMemo` / `useCallback` unless a bug forces it.

### 2.3 Code rules

1. **Hooks:** only `useState`, `useEffect` and `useRef`.
2. **Components:** one per file, default export. Props are destructured, and **no prop types** are needed.
3. **Types:** only in `src/types.ts`. Copy the shapes from `api.md` §4 (`Shade`, `RouteOption`, `Leg`, `Exposure`, `Waypoint`, `Stretch`). Use them where they help; `any` is fine everywhere else.
4. **Data fetching** follows one pattern everywhere:
   ```tsx
   const [data, setData] = useState(null);
   const [loading, setLoading] = useState(true);
   const [error, setError] = useState("");
   useEffect(() => {
     api
       .get("/meta")
       .then((res) => setData(res.data))
       .catch((err) =>
         setError(err.response?.data?.error?.message || "Something went wrong"),
       )
       .finally(() => setLoading(false));
   }, []);
   ```
5. **Every screen** has a loading state, an error state, and an empty state.
6. **Show `null` numbers as "unknown",** never as 0. Show estimates with an "estimate" badge.
7. **Round displayed numbers half up:** `Math.round(x * 10) / 10`.
8. **Never write "safe"** in any UI text.

### 2.4 Shared files (same in both front ends)

**`src/api/client.ts`**

```ts
import axios from "axios";
import fixtures from "./fixtures";

function clientId() {
  let id = localStorage.getItem("clientId");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("clientId", id);
  }
  return id;
}

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL,
  timeout: 30000,
});

api.interceptors.request.use((config) => {
  config.headers["X-Client-Id"] = clientId();
  const token = localStorage.getItem("idToken"); // portal only
  if (token) config.headers["Authorization"] = "Bearer " + token;
  if (import.meta.env.VITE_USE_MOCKS === "true") {
    config.adapter = async () => ({
      data: fixtures(config),
      status: 200,
      statusText: "OK",
      headers: {},
      config,
    });
  }
  return config;
});
```

- `fixtures(config)` returns the JSON from `src/api/fixtures/*.json` that matches `config.method` + `config.url`.
- The fixtures are copies of the `api.md` examples.

**`src/components/MapView.tsx`** (plain MapLibre, tested)

```tsx
import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

export default function MapView({ center, geojson, colorBy }) {
  const box = useRef(null);
  const mapRef = useRef(null);

  useEffect(() => {
    const map = new maplibregl.Map({
      container: box.current,
      style: import.meta.env.VITE_MAP_STYLE_URL, // https://tiles.openfreemap.org/styles/liberty
      center,
      zoom: 15,
    });
    mapRef.current = map;
    return () => map.remove();
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !geojson) return;
    const draw = () => {
      if (map.getSource("lines")) {
        map.getSource("lines").setData(geojson);
        return;
      }
      map.addSource("lines", { type: "geojson", data: geojson });
      map.addLayer({
        id: "lines",
        type: "line",
        source: "lines",
        paint: { "line-width": 5, "line-color": colorBy },
      });
    };
    map.loaded() ? draw() : map.once("load", draw);
  }, [geojson]);

  return <div ref={box} className="h-full w-full" />;
}
```

- **Sun colours:** `["interpolate", ["linear"], ["get", "sunFraction"], 0, "#2F80ED", 1, "#F2994A"]` (blue = shade, orange = sun).
- **Pain colours:** `["interpolate", ["linear"], ["get", "painScore"], 0, "#FDE68A", 100, "#B91C1C"]`.
- **Map tiles:** OpenFreeMap is free and needs no key. Keep the OpenStreetMap attribution visible (the style includes it). It is a public service with no uptime promise, so keep the URL in an env var so we can swap it.

### 2.5 Polling a shade job (the only "advanced" pattern)

```tsx
useEffect(() => {
  if (shade?.status !== "PREPARING" || !shade.jobId) return;
  const started = Date.now();
  const timer = setInterval(async () => {
    const res = await api.get(`/shade/jobs/${shade.jobId}`);
    if (res.data.readyToReplan) {
      clearInterval(timer);
      replan();
    } // send the same plan request again
    if (res.data.status === "FAILED" || Date.now() - started > 120000)
      clearInterval(timer);
    setProgress(res.data);
  }, 3000);
  return () => clearInterval(timer);
}, [shade?.jobId]);
```

### 2.6 Folder layout

The whole project is one repo:

```
sunskip/                    (repo root)
  docs/                     PRD, TRD, api, schema
  api/                      FastAPI + worker (§5.2)
  app/                      student app (below)
  portal/                   officials portal (below)
  .github/workflows/        CI: api job runs when api/** changes; app/portal jobs when their folder changes
  .gitignore
```

```
app/                                 portal/
  index.html                           index.html
  vite.config.ts                       vite.config.ts
  .env.example                         .env.example
  src/                                 src/
    main.tsx       (router)              main.tsx       (router + login guard)
    index.css      (@import "tailwindcss")  index.css
    types.ts                             types.ts
    api/client.ts, api/fixtures/         api/client.ts, api/fixtures/
    components/    (MapView, RouteCard,  auth.ts        (login/logout, token)
                    ShadeBadge, ...)     components/    (MapView, StretchList, HourGrid, ...)
    pages/         (Home, Results,       pages/         (Login, Callback, HeatPain,
                    BestTime, ShadeMap)                 Recommendations, Stretch, Simulate, Stats)
    features/agent/   (P2)
    features/voice/   (P2)
    features/ar/      (P3)
```

- **No npm workspaces.** `app/` and `portal/` are two independent Vite projects, each with its own `package.json` and `node_modules`. Run `npm install` inside each folder.
- **Shared files are copies.** `types.ts`, `api/client.ts`, `MapView.tsx` and the fixtures exist in both. When an API shape changes, update both copies in the same PR.

### 2.7 Test-built setup (copy these files)

**`package.json` (app)**

```json
{
  "name": "sunskip-app",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^19.2.0",
    "react-dom": "^19.2.0",
    "react-router": "^7.18.0",
    "axios": "^1.20.0",
    "maplibre-gl": "^5.24.0"
  },
  "devDependencies": {
    "vite": "^7.3.0",
    "@vitejs/plugin-react": "^5.2.0",
    "typescript": "~5.9.3",
    "tailwindcss": "^4.3.0",
    "@tailwindcss/vite": "^4.3.0",
    "@types/react": "^19.2.0",
    "@types/react-dom": "^19.2.0",
    "vite-plugin-pwa": "^1.3.0"
  }
}
```

- **P3 adds:** `"locar": "0.2.12"` and `"three": "~0.181.2"`.
- **Portal:** same, without `vite-plugin-pwa`.

**`vite.config.ts` (app)**

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "SunSkip",
        short_name: "SunSkip",
        theme_color: "#F2994A",
        background_color: "#ffffff",
        display: "standalone",
        start_url: "/",
        icons: [{ src: "/icon-512.png", sizes: "512x512", type: "image/png" }],
      },
    }),
  ],
  server: { port: 5173, proxy: { "/v1": "http://localhost:8000" } },
});
```

- The build makes `sw.js` and `manifest.webmanifest` (tested). Put `icon-512.png` in `public/`.
- **Portal config:** the same without `VitePWA`, and with `port: 5174`.
- **Local API calls:** set `VITE_API_BASE_URL=/v1`. Vite forwards `/v1` to the local api, so the browser sees one origin and needs no CORS (tested).
- Both front ends can run at once (5173 and 5174).

**`tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": false,
    "noImplicitAny": false,
    "skipLibCheck": true,
    "noEmit": true,
    "isolatedModules": true,
    "types": ["vite/client"]
  },
  "include": ["src"]
}
```

**`src/index.css`:** `@import "tailwindcss";` (Tailwind v4 needs no config file).

**Node version:** 22 LTS (Vite 7 needs Node 20.19+ or 22.12+).

**Build size:** MapLibre makes the bundle ~1.4 MB (388 KB gzipped) in our test. That's fine for the demo; lazy-load the AR page later if needed.

---

## 3. Student app (`app/`)

| Route                        | Screen                                                                                                  | Calls                                       | Notes                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------- | --------------------------------------------------------- |
| `/`                          | **Home:** from/to inputs (GPS button + text), depart time, cheap ↔ cool slider, heat banner             | `GET /meta`, `GET /conditions`              | Banner turns red at feels-like ≥ 40 °C                    |
| `/results`                   | **Route cards:** fastest / cheapest / coolest, sun minutes per walk, warnings, map of the chosen option | `POST /routes/plan`, `GET /shade/jobs/{id}` | "Preparing shade data… 6/18" bar, auto re-plan (§2.5)     |
| `/best-time`                 | **Best time:** one bar per slot (sun minutes), best slot highlighted                                    | `POST /routes/best-time`                    | Label `TEMPERATURE_ONLY` results as "estimate"            |
| `/map`                       | **Shade map:** month + hour sliders, lines blue → orange                                                | `GET /shade/segments`                       | Re-fetch when the map stops moving (`moveend`), max 1 km² |
| `/trip/:tripId/:optionId/ar` | **AR walk** (P3)                                                                                        | waypoints endpoint                          | Mounted from `features/ar`                                |
| (panel on every page)        | **Ask SunSkip** chat + mic (P2)                                                                         | `/agent/chat`, `/voice/*`                   | Mounted from `features/agent`, `features/voice`           |

- **On "Start" tap:** `POST /routes/{tripId}/choice`, then voice directions.
- **Plan state:** keep the last plan request in `useState` on `/results` so a re-plan sends the same body.
- **Mobile first:** design for 360 px wide; one column; big tap targets (`py-3`).
- **Colours:** shade `#2F80ED`, sun `#F2994A`, alert `#B91C1C`. The same colours are used in the map, cards and AR.

---

## 4. Portal (`portal/`)

| Route                 | Screen                                                           | Calls                         |
| --------------------- | ---------------------------------------------------------------- | ----------------------------- |
| `/login`, `/callback` | Cognito hosted login and return                                  | none                          |
| `/`                   | **Heat-pain map:** stretches coloured by pain, list on the right | `GET /portal/heat-pain`       |
| `/recommendations`    | Ranked trees / shelters with cost (estimate) and reason          | `GET /portal/recommendations` |
| `/stretch/:id`        | 12 × 24 sun grid (CSS grid) + walkers breakdown                  | `GET /portal/stretches/{id}`  |
| `/simulate`           | Click the map to add trees/shelters, see before/after            | `POST /portal/simulate`       |
| `/stats`              | Requests, average sun minutes, top origins                       | `GET /portal/stats`           |

- **Desktop first** (1280 px+). Default map area: Jaipur (MUJ + metro stations).
- **On `409 SHADE_PREPARING`:** show "Preparing shade data for this area" and poll the job (§2.5).

### 4.1 Login (simplest working option)

We use **Cognito's hosted login page** with a redirect. There is no auth library.

**`src/auth.ts`**

```ts
const domain = import.meta.env.VITE_COGNITO_DOMAIN; // https://sunskip.auth.ap-south-1.amazoncognito.com
const clientId = import.meta.env.VITE_COGNITO_CLIENT_ID;
const redirect = window.location.origin + "/callback";

export function login() {
  window.location.href =
    `${domain}/oauth2/authorize?client_id=${clientId}&response_type=token` +
    `&scope=openid+email&redirect_uri=${encodeURIComponent(redirect)}`;
}
export function saveTokenFromUrl() {
  // call on /callback
  const p = new URLSearchParams(window.location.hash.slice(1));
  const token = p.get("id_token");
  if (token) {
    localStorage.setItem("idToken", token);
    localStorage.setItem(
      "idTokenExp",
      String(Date.now() + Number(p.get("expires_in")) * 1000),
    );
  }
}
export function isLoggedIn() {
  return (
    !!localStorage.getItem("idToken") &&
    Date.now() < Number(localStorage.getItem("idTokenExp"))
  );
}
export function logout() {
  localStorage.removeItem("idToken");
  window.location.href = `${domain}/logout?client_id=${clientId}&logout_uri=${encodeURIComponent(window.location.origin)}`;
}
```

- **Guard:** in `main.tsx`, if `!isLoggedIn()` and the route isn't `/callback`, call `login()`.
- **Expired token:** an axios `401` response also calls `login()`.
- **Cognito setup:**
  - user pool + app client (public, no secret);
  - enable the **implicit grant** with scopes `openid email`;
  - callback URLs: `http://localhost:5174/callback` and the portal's Amplify URL + `/callback`;
  - sign-out URLs: the same origins.
- **API Gateway JWT authorizer:** issuer `https://cognito-idp.ap-south-1.amazonaws.com/<userPoolId>`, audience = the app client id (the ID token's `aud`).
- **Trade-off:** implicit grant is the least code. Tokens last 1 hour, and then users log in again. That's fine for a hackathon. Switch to code + PKCE later.

---

## 5. Backend (`api/`)

### 5.1 Stack (checked on PyPI 8 Oct 2026; pin what you install)

| Need            | Package                                                               |
| --------------- | --------------------------------------------------------------------- |
| API             | `fastapi`, `uvicorn[standard]`, `pydantic` v2, `pydantic-settings`    |
| DB              | `asyncpg` with plain SQL; migrations are `.sql` files (no ORM)        |
| Geo             | `networkx`, `numpy`, `rasterio`, `shapely`, `pyproj`, `pvlib`         |
| Outside calls   | `httpx` (Google, Open-Meteo, Overpass), `boto3` (S3, Secrets Manager) |
| AI / voice (P2) | `anthropic`, `sarvamai`                                               |
| Lint            | `ruff` (no test files; we test manually, see `CLAUDE.md`)             |

**Python version:** 3.12.

### 5.2 Folders

```
api/
  app/
    main.py            all 18 routers registered (stubs return 501 on day 0)
    config.py          settings from env + Secrets Manager
    core/              middleware (request id, origin secret, client hash), errors, shared helpers
    contracts/         Pydantic models from api.md, fakes   (all 3 approve changes)
    db/                pool, *_queries.py, cleanup
    routes/  shade/  conditions/  meta/  portal/  health/
    agent/   voice/                                                          (Person 2)
    worker/            __main__.py: job loop, overpass.py, solar.py, scoring.py, demand.py (nightly 02:00 IST)
  migrations/          0001_init.sql (= schema.md §9)
  scripts/             migrate.py, preload.py, seed_zones.py
  Dockerfile  docker-compose.yml  docker-compose.dev.yml  .env.example
```

### 5.3 Rules

- **Async everywhere;** one `httpx.AsyncClient` per process.
- **camelCase JSON:** `alias_generator=to_camel`, `populate_by_name=True`.
- **Every outside call:**
  - has a 10 s timeout;
  - updates `service_status`;
  - never logs keys or request bodies.
- **Fakes:** with `USE_FAKES=true`, the `contracts/` fakes return the real Bus 26 numbers (810 m, 11.3 / 7.4 min).
- **Middleware order:** request id → origin secret → client hash. No rate limiter in v1 (API Gateway throttles at 50 req/s).
- **One api process:** uvicorn runs with `--workers 1`, because the cleanup task must run once. Run the NetworkX route search with `await asyncio.to_thread(...)` so a slow search never blocks other requests.
- **Worker:** the same Docker image, started with `python -m app.worker`. It needs no HTTP server. It writes a heartbeat to `service_status` every 30 s and runs the demand job once a night.
- **Migrations:** plain SQL files in `api/migrations/`, applied in name order by `python -m scripts.migrate` (it records applied files in `schema_migrations`).

---

## 6. AI and voice (Person 2)

- **Claude:** `anthropic` SDK, Messages API with tools.
  - Model from `CLAUDE_MODEL`.
  - Max 4 tool rounds.
  - Number check + template fallback (`api.md` endpoint 9).
- **Sarvam:** `sarvamai` SDK.
  - STT: clips under 30 s (WebM, MP4, WAV). `/voice/stt` makes 2 calls: STT (`mode: transcribe`), then translate to English.
  - Translate.
  - Bulbul TTS.
  - Model names come from env vars.
- **Audio cache:** S3 key `audio/{sha256(text|language|voice)}.mp3`, returned as a presigned URL (1 h).
- **Front end:** `features/agent/ChatPanel.tsx`, `features/voice/MicButton.tsx`, `features/voice/Player.tsx`, using the same code rules as §2.
- **Fallbacks:** browser `speechSynthesis` when `audioUrl` is null; a template answer when Claude fails.

---

## 7. AR (Person 3)

- **Libraries:** `locar@0.2.12` + `three@0.181.x`, plain three.js in `features/ar/ARView.tsx` (no react-three-fiber).
- **Data:** the waypoints endpoint (`api.md` endpoint 7); use the fixture until the endpoint is live.
- **Phone testing:** needs HTTPS. Use `@vitejs/plugin-basic-ssl` + `vite --host` locally; Amplify in production.
- **Full plan:** milestones M1 to M6, accuracy fixes and look-and-feel rules are in the handbook PDF §4.

---

## 8. Infrastructure (Suryansh, Thu 8 Oct night)

| Service         | Setting                                                                                                                                                                                                                                                                                                   |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Region          | `ap-south-1` (Mumbai) for everything                                                                                                                                                                                                                                                                      |
| EC2             | Ubuntu 24.04, `t3.medium` (4 GB, for rasterio + numpy + graphs), Elastic IP, Docker + compose. Port 8000 must be open, because API Gateway has no fixed IPs; the origin secret blocks direct calls                                                                                                        |
| RDS             | PostgreSQL 16, `db.t4g.micro`, 20 GB, not public; `CREATE EXTENSION postgis` via `0001_init`                                                                                                                                                                                                              |
| S3              | One private bucket: `shade/`, `audio/`                                                                                                                                                                                                                                                                    |
| Secrets Manager | `sunskip/prod`: Google, Anthropic, Sarvam keys, `DATABASE_URL`, `ORIGIN_SECRET`, `CLIENT_ID_SALT`                                                                                                                                                                                                         |
| API Gateway     | HTTP API, 2 routes (§8.1 step 8); parameter mapping `overwrite:header.X-Origin-Secret` on both integrations; JWT authorizer only on the portal route; throttle 50 req/s; **CORS** for the two Amplify URLs + `localhost:5173` + `localhost:5174`, with headers `Content-Type, X-Client-Id, Authorization` |
| Cognito         | User pool + public app client, hosted login, implicit grant (§4.1)                                                                                                                                                                                                                                        |
| Amplify Hosting | Two apps from the same GitHub repo, branch `main`: tick **"My app is a monorepo"** and set the app root to `app` for one and `portal` for the other; SPA rewrite rule below; env vars as in §9                                                                                                         |
| IAM             | EC2 role: S3 read/write on the bucket, read on the secret                                                                                                                                                                                                                                                 |

- **Amplify SPA rewrite** (Rewrites and redirects, type 200, target `/index.html`). This is the Amplify docs rule plus `webmanifest` for the PWA:
  ```
  </^[^.]+$|\.(?!(css|gif|ico|jpg|js|png|txt|svg|woff|woff2|ttf|map|json|webp|webmanifest)$)([^.]+$)/>
  ```
  Page URLs load the app; JS, CSS, icons and the manifest still load (tested). A plain `/<*>` rule would break them.
- **CORS lives in API Gateway only.** Don't add CORS in FastAPI too, or the headers get doubled.
- **Cost:** stop EC2 and RDS when they're not needed after the hackathon.

### 8.1 Deploy the API + worker (Docker on EC2)

Both containers run on the same EC2 machine from **one image**:

- the `api` container serves requests;
- the `worker` container runs the shade-job loop.

They never call each other. The `shade_jobs` table in Postgres connects them.

**`requirements.txt`** (tested: installs and imports cleanly on Python 3.12; rasterio ships its own GDAL, but the slim image needs `libexpat1`, which the Dockerfile installs)

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

**`Dockerfile`**

```dockerfile
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /srv
RUN apt-get update && apt-get install -y --no-install-recommends libexpat1 && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
```

**`docker-compose.yml`** (`docker compose config` passes)

```yaml
services:
  api:
    build: .
    ports: ["8000:8000"]
    env_file: .env
    volumes: ["shade-cache:/srv/.data"]
    restart: unless-stopped
  worker:
    build: .
    command: python -m app.worker
    env_file: .env
    volumes: ["shade-cache:/srv/.data"]
    restart: unless-stopped
volumes:
  shade-cache: # local copy of the Solar files; S3 keeps the master copy
```

**`docker-compose.dev.yml`** (local only, day 0; the cloud uses RDS instead)

```yaml
services:
  db:
    image: postgis/postgis:16-3.4
    environment:
      {
        POSTGRES_DB: sunskip,
        POSTGRES_USER: sunskip,
        POSTGRES_PASSWORD: sunskip,
      }
    ports: ["5433:5432"] # 5433 so it never clashes with a Postgres already installed on the laptop
```

- Run `docker compose -f docker-compose.dev.yml up -d`, then set `DATABASE_URL=postgresql://sunskip:sunskip@localhost:5433/sunskip` in your local `.env` and run `python -m scripts.migrate`.
- Run the api with `uvicorn app.main:app --reload` and the worker with `python -m app.worker`. Locally set `ORIGIN_SECRET_CHECK=false` and leave `SECRET_ID` empty: `config.py` reads env vars first and only calls Secrets Manager when `SECRET_ID` is set.
- The image is amd64 only; on an Apple-silicon Mac it runs slower through emulation.

**One-time setup (Thu night)**

1. **Launch EC2:** Ubuntu 24.04, `t3.medium`, `ap-south-1`.
   - Attach an **Elastic IP** and the **IAM role** from the table above.
   - Security group: port 22 from your IP only; port 8000 open.
2. **RDS access:** in the RDS security group, allow port 5432 **only from the EC2 security group**.
3. **Install and clone:**
   ```bash
   sudo apt update && sudo apt install -y docker.io docker-compose-v2 git
   sudo usermod -aG docker ubuntu && newgrp docker
   git clone <sunskip repo> sunskip && cd sunskip/api
   ```
4. **Create `.env`:** only non-secret settings plus `AWS_REGION=ap-south-1` and `SECRET_ID=sunskip/prod`. `config.py` reads the keys from Secrets Manager through the IAM role, so no keys sit on disk.
5. **Create the tables:**
   ```bash
   docker compose run --rm api python -m scripts.migrate
   ```
6. **Start and check:**
   ```bash
   docker compose up -d --build
   curl localhost:8000/v1/health
   ```
7. **Preload the demo areas:**
   ```bash
   docker compose run --rm api python -m scripts.preload --area muj
   docker compose run --rm api python -m scripts.preload --area jaipur-metro
   ```
8. **Connect API Gateway** (HTTP API, `$default` stage, auto-deploy on). Make 2 HTTP proxy integrations and 2 routes:

   | Route                     | Integration URL                              | Authorizer  |
   | ------------------------- | -------------------------------------------- | ----------- |
   | `ANY /v1/portal/{proxy+}` | `http://<elastic-ip>:8000/v1/portal/{proxy}` | Cognito JWT |
   | `ANY /v1/{proxy+}`        | `http://<elastic-ip>:8000/v1/{proxy}`        | none        |
   - The more specific portal route wins, so `/portal/*` always needs a login.
   - On **both** integrations add the request parameter `overwrite:header.X-Origin-Secret` = the `ORIGIN_SECRET` value. `overwrite` replaces any value a caller sends.
   - CORS is set on the API, so the gateway answers browser `OPTIONS` pre-checks itself, before the authorizer.
   - The public URL is then `https://<api-id>.execute-api.ap-south-1.amazonaws.com/v1/...`, matching `api.md`.

**Updating** (after each merge to `main`, before demos)

```bash
cd sunskip/api && git pull && docker compose up -d --build
```

**Watching**

- `docker compose ps` shows both containers.
- `docker compose logs -f worker` shows the shade jobs.
- `/health` shows the worker heartbeat and the job queue.
- `restart: unless-stopped` brings both back after a crash or reboot.

---

## 9. Environment variables

| Folder      | Variable                                        | Example                                                                                               |
| ----------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| app, portal | `VITE_API_BASE_URL`                             | `/v1` locally (Vite forwards it); `https://abc123.execute-api.ap-south-1.amazonaws.com/v1` on Amplify |
| app, portal | `VITE_USE_MOCKS`                                | `true` locally until the API is up                                                                    |
| app, portal | `VITE_MAP_STYLE_URL`                            | `https://tiles.openfreemap.org/styles/liberty`                                                        |
| portal      | `VITE_COGNITO_DOMAIN`, `VITE_COGNITO_CLIENT_ID` | from Cognito                                                                                          |
| api         | settings list                                   | `api.md` §11 and `schema.md` §8                                                                       |

Never put secrets in `VITE_*` variables: everything in them ships to the browser.

---

## 10. Quality bar

- **Speed (p95):** plan 3 s, best time 6 s, agent 15 s, everything else 1 s. API Gateway's limit is 29 s.
- **Testing is manual (no test files):**
  - **API:** with `USE_FAKES=true`, call `/routes/plan` and `/routes/best-time` and check the pilot numbers by hand: 810 m, 11.3 min at 1 PM, 7.4 min at 5 PM, heat dose 29.3. Check the shade job flow by planning a trip in a new area.
  - **Front ends:** click through every screen (loading, error, empty states) and test on one Android and one iPhone.
- **CI on every PR:** `ruff check` (API); `tsc -b && vite build` (front ends).
- **Security:**
  - the origin secret must be on;
  - only client-id hashes are stored;
  - logged locations are rounded to ~50 m;
  - no keys in the repo; rotate the Google key that was shared in chat.
- **Demo checklist (Sun 14:00):**
  - `/health` green;
  - MUJ + Jaipur metro areas preloaded;
  - mocks off;
  - Amplify URLs work on mobile data, not just Wi-Fi.

---

## 11. Decisions

| Topic              | Decision                                                       | Why                                                                      |
| ------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Repo layout        | One monorepo: `api/`, `app/`, `portal/`                        | One clone, one CI; API shape changes land in one PR across all three     |
| Front-end language | `.tsx`, `strict: false`, types only in `types.ts`              | Fast to write; types where they help                                     |
| Back-end hosting   | One EC2 machine, Docker Compose, two containers from one image | Simplest setup that runs a long-lived worker; no ECS/Kubernetes to learn |
| State              | `useState` / `useEffect` only                                  | Simple; 3-day build                                                      |
| Map                | Plain `maplibre-gl`                                            | One library, no wrappers                                                 |
| Portal map layers  | MapLibre line layers (no deck.gl)                              | Enough for coloured stretches                                            |
| Charts             | Tailwind `div`s and CSS grid                                   | No chart library to learn                                                |
| Portal login       | Cognito hosted login, implicit grant                           | No auth library; works with the gateway JWT check                        |
| Map tiles          | OpenFreeMap, URL in env                                        | Free, no key                                                             |
| Versions           | Vite 7, React Router 7, TS 5.9, Tailwind 4                     | Stable and well documented                                               |

---

## 12. Sources

- npm and PyPI registries (versions checked 8 Oct 2026); our local test build of the app setup.
- [OpenFreeMap quick start](https://openfreemap.org/quick_start/)
- [MapLibre styles and providers (OpenFreeMap: no API key)](https://scripts.nuxt.com/scripts/maplibre/guides/styles-and-providers)
- [Cognito React example (Vite react-ts template)](https://docs.aws.amazon.com/cognito/latest/developerguide/getting-started-test-application-react.html)
