# SunSkip student app

The phone-first app: routes with the least direct sun, the best time to leave, a shade map, spoken
directions, an AR walk view and Ask SunSkip. Vite + React, built to `docs/TRD.md` §2 and `docs/design.md`.
Screens are numbered as in `docs/ui-screens.pdf`.

## Run it

```bash
cd app
npm install
cp .env.example .env      # PowerShell: Copy-Item .env.example .env
npm run dev               # https://localhost:5173 and a Network URL for phones
npm run build             # tsc -b && vite build (what CI runs)
```

The dev server is HTTPS with a self-signed certificate, because phones only share the camera, GPS and
compass with HTTPS pages. The browser warns once: choose Advanced, then Proceed.

| `.env` variable | What it does |
| --- | --- |
| `VITE_API_BASE_URL` | `/v1` locally (the dev server forwards it); the full API URL on Amplify |
| `VITE_USE_MOCKS` | `true` answers every call from `src/api/fixtures/`, no backend needed |
| `VITE_MAP_STYLE_URL` | OpenFreeMap Positron style |
| `API_PROXY_TARGET` | Where the dev server forwards `/v1`. Default `http://localhost:8000`. Not sent to the browser |
| `VITE_DEMO_NOW` | Optional. The time the app treats as "now", e.g. `2026-05-15T13:00:00+05:30` (the demo runs in May, PRD §9) |

### On a phone, with mocks

1. Leave `VITE_USE_MOCKS=true` and run `npm run dev`.
2. Put the phone on the same Wi-Fi and open the **Network** URL Vite prints (`https://<laptop-ip>:5173`).
3. Accept the certificate warning. With mocks the app stands at MUJ main gate on Fri 15 May, 1 PM.

If the page doesn't load, allow Node.js through Windows Firewall for private networks.

### On a phone, with the live API

Set these in `.env` and restart `npm run dev`:

```
VITE_USE_MOCKS=false
API_PROXY_TARGET=https://7mhceh7sl0.execute-api.ap-southeast-2.amazonaws.com
VITE_DEMO_NOW=2026-05-15T13:00:00+05:30    # optional: plan as if it were the May demo day
```

The phone still opens `https://<laptop-ip>:5173`. Its calls go to `/v1` on the laptop and Vite forwards
them to the API (`changeOrigin`), so the browser sees one origin and CORS never comes into it.
Allow location when asked; if you refuse, the app starts from MUJ main gate.

### Mock states

Add `?state=` to any URL once; it stays for the browser tab until `?state=ready`.

| URL | Shows |
| --- | --- |
| `/?state=preparing` | Screen 07: "13 of 45 map areas ready", polling every 3 s, then the ranked routes by themselves |
| `/?state=noshade` | Screen 25: no shade data, sun minutes "unknown", best time as an estimate |
| `/?state=noroute` | Screen 23: no route found |
| `/?state=offline` | Screen 24: can't reach SunSkip (every call fails) |

With mocks there is no GPS on the walk: navigation stands 6 waypoints in, like screen 14 (`?step=0..32` moves it).
The AR view needs a camera; on a laptop use `/trip/mock-walk-13/opt_2?view=ar&desk=1`.

## Where things are

```
src/
  main.tsx            routes
  types.ts            the api.md §4 shapes
  format.ts           numbers, times, labels (null is "unknown", round half up, IST)
  geo.ts              distances, map boxes, the walking maths on waypoints
  session.ts          what pages hand each other through sessionStorage (search, walk, recents)
  api/client.ts       the axios client from TRD §2.4
  api/fixtures/       mock answers: captures of the real API for 15 May
  api/useShadeJob.ts  the TRD §2.5 polling, used by Results, Home and the shade map
  api/walk.ts         one walk planned on its own at a given hour (walk detail, shade map)
  api/live.ts         is an agent or voice endpoint past its 501 stub?
  components/         MapView and the shared pieces
  pages/              Home, Search, Results (+ OptionDetail), WalkDetail, BestTime, ShadeMap, Navigate
  features/agent/     ChatPanel, ChatMessage                         (P2)
  features/voice/     MicButton, Player, SpokenDirections, speech    (P2)
  features/ar/        the AR walk view                               (P3, copied from the ar project)
```

Routes: `/`, `/search`, `/results`, `/results/:optionId`, `/walk`, `/best-time`, `/map`,
`/trip/:tripId/:optionId?view=map|ar|arrow`.

## Agent and voice (P2)

Everything that calls `/agent/*` and `/voice/*` is in `features/agent` and `features/voice`; the pages only mount it.

| Piece | Props | Calls |
| --- | --- | --- |
| `ChatPanel` | `tripId`, `location`, `about` (one line of context), `listen` (start by listening), `onClose` | `POST /agent/chat` |
| `MicButton` | `onTranscript({ transcript, language, english, seconds })`, `onListening(bool)`, `onError(text)`, `autoStart` | `POST /voice/stt` (multipart `audio`) |
| `Player` | `text`, `language`, `audioUrl` | none: plays `audioUrl`, or the browser's speech when it is null |
| `SpokenDirections` | `tripId`, `optionId`, `points` (the walk's waypoints), `at` (index the walker is at), `muted`, `caption`, `language` | `POST /voice/instructions` |

- Until an endpoint is live it answers 501. `api/live.ts` sends it an empty body once: 501 hides the feature
  (the Ask buttons on Home and Results, the mic), anything else shows it. A live endpoint must turn an empty
  body down as a bad request without doing any work.
- Spoken directions fall back to the English waypoint cues read by the browser when `/voice/instructions` fails.

## AR (P3)

`src/features/ar/` is a copy of `ar/src/features/ar/` (commit `e8ba770`). It keeps its own style (strict types,
its own helpers, `useMemo` / `useEffectEvent`). It compiled here unchanged; two edits were made in the copy:

- `ARView.tsx`: new optional prop `onUseArrow(reason)`. With it the sheet shows "Use arrow" (`'chosen'`), and the
  walker is sent to the arrow screen by itself when the camera or a permission fails (`'unavailable'`).
- `BottomSheet.tsx`: the `'use-arrow'` action for that link.

`pages/Navigate.tsx` loads it with `React.lazy`, so three.js and LocAR stay out of the main bundle.

## Where it differs from the docs

- `api/client.ts` is TRD §2.4 plus one `await` in the mock adapter, so fixtures can be slow and can fail.
- `tsconfig.json` adds `allowImportingTsExtensions` (the AR folder imports with `.ts` endings).
- `MapView` takes more than TRD's sample (`camera`, `streets`, `lines`, markers): design.md §6 needs those layers.
- Extra files next to `types.ts`: `format.ts`, `geo.ts`, `session.ts`; and `api/walk.ts`, `api/live.ts`, `api/useShadeJob.ts`.
- `VITE_DEMO_NOW` is new (TRD §9 doesn't list it).
- "Arrive by" plans twice: the API only takes a leave time, so the first plan measures the trip.
- Walk detail and the shade map plan the walk again for each hour picked, to get that hour's sun on every piece.
