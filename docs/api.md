# SunSkip API (v1)

> **SunSkip: Skip the sun, not the trip.**
>
> - **What it is:** an app that shows the walking + transit route with the least direct sun, anywhere in India, and a portal that shows officials where shade is missing.
> - **Build from:** the `api/` folder (FastAPI) is built from this file + `schema.md`; stack, folders and setup are in `TRD.md`. FastAPI's `/docs` is the exact contract; this file explains the rules.
> - **Real numbers:** examples marked **(real)** come from our pilot walk at MUJ, Jaipur. All other numbers are examples only.

---

## 1. Build rules

1. **Never invent numbers.** Every number shown to a user comes from data or a formula in this file. Estimates are labelled.
2. **Never make a request wait for shade data.** If an area isn't ready, return results now with `shade.status: "PREPARING"` and a `jobId`.
3. **Finish every request in under 29 s.** That is API Gateway's hard limit for HTTP APIs.
4. **Pydantic v2, camelCase JSON:** `alias_generator=to_camel`, `populate_by_name=True`. Python code stays snake_case.
5. **Round displayed decimals half up.** 11.25 shows as 11.3; Python's `round()` would give 11.2.
6. **Front ends use axios only** (no TanStack Query).

---

## 2. System

```
sunskip-app ────┐
                ├─ HTTPS ─> API Gateway (adds X-Origin-Secret; Cognito check on /portal/*) ─> EC2
sunskip-portal ─┘                                                                          ├─ api container (FastAPI)
                                                                                           └─ worker container (shade jobs)
api    → Google Routes, Google Air Quality, Open-Meteo, Claude API, Sarvam
worker → Google Solar (shade), OpenStreetMap Overpass (walkways, stops)
both   → RDS PostgreSQL + PostGIS (data + job queue), S3 (shade files, audio), Secrets Manager
```

- **Base URL:** `https://7mhceh7sl0.execute-api.ap-southeast-2.amazonaws.com/v1`
- **Local:** the api runs at `http://localhost:8000/v1` with `ORIGIN_SECRET_CHECK=false`. Front ends use `VITE_API_BASE_URL=/v1`; the Vite dev server forwards it (TRD §2).

---

## 3. Rules for every call

### Headers

| Header                                  | Sent by         | Rule                                                                                                             |
| --------------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------- |
| `X-Origin-Secret`                       | API Gateway     | FastAPI rejects calls without it (`403`). Clients never send it                                                  |
| `X-Client-Id`                           | Both front ends | Random UUID kept in `localStorage`. Required on all calls except `/portal/*` and `/health`. We store only a hash |
| `Authorization: Bearer <Cognito token>` | Portal          | Checked by API Gateway on `/portal/*`                                                                            |
| `X-Request-Id`                          | API             | Returned on every response and in errors                                                                         |

### Formats

- **Time:** ISO 8601 in IST, e.g. `2026-05-15T13:00:00+05:30`. Hours are 0 to 23 IST.
- **Points:** `{ "lat": 26.84409, "lng": 75.56527 }`. GeoJSON uses `[lng, lat]`.
- **Units:** metres, seconds, minutes (1 decimal), °C (1 decimal), whole rupees.
- **Languages:** `en-IN`, `hi-IN` (Hinglish is accepted as either).
- **IDs:** `seg_123`, `str_007`, `opt_1`. Trips, sessions and jobs are UUIDs.
- **Unknown values are `null`,** never `0`.

### Errors

Every error looks like `{ "error": { "code", "message", "requestId" } }`.

| HTTP    | Code              | When                                                                                                                    | App does                   |
| ------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| 400     | `INVALID_REQUEST` | Bad field, bad audio                                                                                                    | Show the error             |
| 401     | `UNAUTHORIZED`    | Portal call without login. Sent by API Gateway as `{"message":"Unauthorized"}`, not our shape, so check the status only | Go to login                |
| 403     | `FORBIDDEN`       | Missing gateway secret                                                                                                  | Show "no access"           |
| 404     | `NOT_FOUND`       | Unknown or expired trip, stretch, session or job                                                                        | Re-plan                    |
| 409     | `SHADE_PREPARING` | Portal needs shade that is still being prepared (body has `jobId`)                                                      | Poll the job, retry        |
| 422     | `NO_ROUTE_FOUND`  | No route, or place not found                                                                                            | Suggest auto / pick on map |
| 422     | `NO_SHADE_DATA`   | Portal needs shade; Google has none there                                                                               | Explain                    |
| 429     | `RATE_LIMITED`    | Not used in v1 (reserved). Too many calls (`Retry-After` set)                                                           | Wait                       |
| 502/504 | `UPSTREAM_ERROR`  | Google, Sarvam, Claude or Open-Meteo failed                                                                             | Use a fallback             |
| 500/503 | `INTERNAL_ERROR`  | Our bug or DB down                                                                                                      | Retry once, then a banner  |
| 501     | `NOT_IMPLEMENTED` | Agent and voice endpoints until P2's code is in                                                                         | Hide the feature (the app checks `/meta` `features`, so it never needs this) |

**Student-app endpoints never fail because shade is missing.** They return results with a `shade` block and `null` sun fields instead.

### Limits, caching, speed

- **Rate limits:** API Gateway's 50 requests/s throttle only. FastAPI has no per-client limiter in v1, so `429 RATE_LIMITED` is not used yet (P2 may add a simple limit on `/agent/chat` and `/voice/*` if Claude/Sarvam cost needs it).
- **Caching:**
  - trips: 30 min in `trips`;
  - Google Routes responses: 24 h;
  - weather/air: 15 min per ~1 km area;
  - audio: forever in S3 (presigned URL valid 1 h);
  - HTTP caching: `/meta` 1 h; `/shade/segments` 1 day **only when `shade.status` is READY**, otherwise `no-store`.
- **Speed targets (p95):**

  | Endpoint              | Target |
  | --------------------- | ------ |
  | `/routes/plan`        | 3 s    |
  | `/routes/best-time`   | 6 s    |
  | `/agent/chat`         | 15 s   |
  | `/voice/instructions` | 8 s    |
  | All others            | 1 s    |

---

## 4. Data shapes

```ts
LatLng      { lat, lng }
Place       { name | null, location: LatLng }
PlaceInput  { lat, lng } | { query }              // query is looked up by Google (India)

Shade       { status: "READY" | "PREPARING" | "UNAVAILABLE", jobId | null,
              reason: "OUTSIDE_INDIA" | "NO_DATA" | "BUDGET" | null,   // only when UNAVAILABLE
              cellsTotal?, cellsDone?, pollAfterSeconds? }
            // READY: shade data present · PREPARING: a job is running, poll it
            // UNAVAILABLE: it's outside India (OUTSIDE_INDIA), Google has no shade data here (NO_DATA), or
            //   the monthly Solar budget or this device's daily allowance is used up (BUDGET)

Exposure    { walkMeters, walkMinutes,
              sunMinutes | null,        // minutes walking in direct sun
              sunMinutesHot | null,     // same, only while feels-like >= 40 °C
              waitSunMinutes | null,    // minutes waiting at an unshaded stop
              shadePct | null,          // 0..100
              heatDose | null,          // ranking score (below)
              feelsLikeC | null }       // highest during the walk

Leg         { mode: "WALK" | "BUS" | "METRO" | "RAIL" | "ERICKSHAW",
              from: Place, to: Place, startAt, endAt, distanceMeters, durationSeconds, polyline,
              shadeKnown,                          // WALK: true if we have shade for it
              coverage: "FULL" | "PARTIAL" | "NONE",   // WALK: how much of the walk has shade data
              exposure | null,                     // WALK only
              line | null,                         // transit: { shortName, name, vehicle, headwaySeconds }
              waitSeconds | null, stopShaded | null,
              fareInr | null,                      // ERICKSHAW only
              swappedFrom: "WALK" | null }         // ERICKSHAW that replaced a walk

RouteOption { optionId: "opt_1".."opt_6", labels: ("RECOMMENDED"|"FASTEST"|"CHEAPEST"|"COOLEST")[],
              departAt, arriveAt, durationSeconds,
              fareInr | null,                      // Google transit fare + e-rickshaw fares
              exposure, legs: Leg[],
              warnings: ("HEAT_ALERT"|"FARE_ESTIMATED"|"LONG_WAIT_IN_SUN"|
                         "SHADE_PREPARING"|"NO_SHADE_DATA"|"NO_SHADE_DATA_PARTIAL")[] }

Waypoint    { index, location, distanceFromStartM, legIndex, bearingDeg, inSun | null, cue | null }
Stretch     { stretchId, name, lengthM, geometry, walkersPerDay, sunShare, painScore }
```

### Formulas

```
heatWeight(f) = 0               if f < 30          (f = feels-like °C for that hour; unknown → 1)
              = (f − 30) / 10   if 30 <= f < 40
              = 1 + (f − 40)/5  if f >= 40

sunMinutes    = Σ segment length_m × sun_fraction[segment, month, hour] ÷ 1.2 ÷ 60
                (the hour moves forward as you walk at 1.2 m/s)

waitSunMinutes = 0                          if the stop is shaded
               = waitSeconds/60             if we don't know (assume sun)
               = waitSeconds/60 × stop sun_fraction   otherwise

heatDose      = Σ over each hour of (sun minutes + wait-in-sun minutes in that hour) × max(heatWeight, 0.1)

painScore     = 100 × walkersPerDay × sunShare × lengthM ÷ (highest value in the result)
```

- **Check (real):** 810 m in full sun at 1.2 m/s = 11.25 → **11.3 min**.
- **Example (real sun, example wait):** 11.3 + 5.0 = 16.3 min at feels-like 44 °C (weight 1.8) gives a dose of **29.3**.

**Ranking** (`preference` p: 0 = cheap/fast, 1 = cool):

- Scale duration `d`, fare `c` and heat dose `h` to 0..1 across the options. An unknown value counts as 1.
- `score = p × h + (1 − p) × (0.5 × d + 0.5 × c)`. **Lowest score = RECOMMENDED.**
- Only the best 6 by score are returned (`MAX_OPTIONS`). The labels below are given after that cut, so each one points at an option the user can see.
- **Other labels:**
  - `FASTEST` = shortest time;
  - `CHEAPEST` = lowest known fare;
  - `COOLEST` = lowest known heat dose.

---

## 5. Endpoints (19)

| #   | Endpoint                                            | Used by     | Owner              |
| --- | --------------------------------------------------- | ----------- | ------------------ |
| 1   | `GET /meta`                                         | app, portal | P1                 |
| 2   | `GET /shade/segments`                               | app         | P1                 |
| 3   | `GET /shade/jobs/{jobId}`                           | app, portal | P1                 |
| 4   | `GET /conditions`                                   | app         | P1                 |
| 5   | `POST /routes/plan`                                 | app         | P1                 |
| 6   | `POST /routes/best-time`                            | app         | P1                 |
| 7   | `GET /routes/{tripId}/options/{optionId}/waypoints` | app (AR)    | P1 builds, P3 uses |
| 8   | `POST /routes/{tripId}/choice`                      | app         | P1                 |
| 9   | `POST /agent/chat`                                  | app         | P2                 |
| 10  | `POST /voice/instructions`                          | app         | P2                 |
| 11  | `POST /voice/tts`                                   | app         | P2                 |
| 12  | `POST /voice/stt`                                   | app         | P2                 |
| 13  | `GET /portal/stats`                                 | portal      | P1                 |
| 14  | `GET /portal/heat-pain`                             | portal      | P1                 |
| 15  | `GET /portal/recommendations`                       | portal      | P1                 |
| 16  | `POST /portal/simulate`                             | portal      | P1                 |
| 17  | `GET /portal/stretches/{stretchId}`                 | portal      | P1                 |
| 18  | `GET /health`                                       | team        | P1                 |
| 19  | `GET /places`                                       | app         | P1                 |

- **Auth:** `/portal/*` needs a Cognito login (checked by API Gateway). Every other endpoint, including 1 and 3 when the portal calls them, needs only `X-Client-Id` (both front ends always send it). `/health` needs neither (only the gateway secret).
- **Owners:** P1 = Suryansh (backend + front ends), P2 = AI/voice, P3 = AR.

---

## 6. App endpoints

### 1. `GET /meta`

**Does:** tells the app how shade works and the global settings.

```json
{
  "shadeModel": "ON_DEMAND",
  "region": "IN",
  "shadeImageryDates": { "min": "2025-04-19", "max": "2025-04-19" },
  "shadeBudget": { "state": "OK" },
  "representativeDay": 15,
  "languages": ["en-IN", "hi-IN"],
  "modes": ["WALK", "BUS", "METRO", "RAIL", "ERICKSHAW"],
  "heatAlertFeelsLikeC": 40,
  "features": { "agent": false, "voice": false }
}
```

- `2025-04-19` is our real MUJ imagery date.
- `shadeBudget.state` is `OK` or `EXHAUSTED`.
- **`features`** says whether the agent (endpoint 9) and voice (10–12) are live (`AGENT_LIVE`, `VOICE_LIVE`). The app shows Ask SunSkip, the mic and spoken audio only when they are true. `/meta` is cached for an hour, so a change shows up within the hour.

### 2. `GET /shade/segments?bbox=w,s,e,n&month=5&hour=12`

**Does:** footpaths coloured by sun for a month and hour.

```json
{
  "month": 5,
  "hour": 12,
  "shade": {
    "status": "PREPARING",
    "jobId": "9d2e...",
    "cellsTotal": 14,
    "cellsDone": 6
  },
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "properties": {
        "id": "seg_412",
        "sunFraction": 1.0,
        "lengthM": 42,
        "stretchId": "str_007"
      },
      "geometry": {
        "type": "LineString",
        "coordinates": [
          [75.56406, 26.84187],
          [75.5642, 26.8415]
        ]
      }
    }
  ]
}
```

- **bbox:** max 1 km².
- **Missing cells** are queued as a `MAP` job; segments that are ready return now.
- **`sunFraction` is 0** when the sun is below 5°.
- **`sunFraction` is `null`** when Google has no shade data for that segment at that hour (unknown, not shade); the app draws it grey.

### 3. `GET /shade/jobs/{jobId}`

**Does:** shows progress of a background shade job, so the app knows when to re-plan.

```json
{
  "jobId": "9d2e...",
  "status": "RUNNING",
  "reason": "PLAN",
  "cellsTotal": 18,
  "cellsDone": 11,
  "cellsNoData": 1,
  "pollAfterSeconds": 3,
  "readyToReplan": false
}
```

- **`status`:** `QUEUED`, `RUNNING`, `DONE` or `FAILED`. `readyToReplan` is true when `DONE`.
- **The app** polls every 3 s and gives up after 2 min, keeping the plain routes.
- **404** after 7 days.

### 4. `GET /conditions?lat=&lng=&at=`

**Does:** temperature, feels-like and air quality for the heat banner.

```json
{
  "at": "2026-10-08T13:00:00+05:30",
  "tempC": 34.1,
  "feelsLikeC": 36.0,
  "naqi": 112,
  "naqiCategory": "Moderate",
  "heatAlert": false,
  "hourly": [
    { "at": "2026-10-08T14:00:00+05:30", "tempC": 34.6, "feelsLikeC": 36.4 }
  ],
  "source": { "weather": "open-meteo", "air": "google-air-quality" },
  "stale": false,
  "typical": false
}
```

- **`heatAlert`** = feels-like ≥ 40 °C. `hourly` covers 24 h.
- **More than 7 days ahead:** the weather on the same weekday in the latest past year the archive has (usually last year), with `typical: true` and `naqi: null`.
- **If the source is down:** serve cached data up to 24 h old with `stale: true`, then `502`.

### 5. `POST /routes/plan` (core)

**Does:** transit options re-scored by heat. Works anywhere in India.

**Request**

```json
{
  "origin": { "lat": 26.84409, "lng": 75.56527 },
  "destination": { "query": "Mansarovar Metro Station, Jaipur" },
  "departAt": "2026-05-15T13:00:00+05:30",
  "preference": 0.7,
  "allowErickshaw": true
}
```

- `departAt` defaults to now; `preference` defaults to 0.5.
- **Arrive by:** send `arriveBy` instead of `departAt` (both is `400`). The API asks Google for transit that arrives by then, leaves as early as the longest trip needs, then checks the trips it would plan from that time and leaves earlier again (up to twice) by however late the latest one is. Every option arrives by `arriveBy`; some arrive earlier, because buses are not every minute.
- **Send map/GPS points when you can.** In testing, the text "Manipal University Jaipur" was placed 20+ km away in Jaipur city.

**Steps**

1. **Google Routes:**
   - Call `TRANSIT` with `computeAlternativeRoutes: true`, `languageCode: "en"`, `regionCode: "IN"`. Add `routes.travelAdvisory.transitFare` to the field mask.
   - Cache 24 h.
   - Remove duplicate options.
   - Also add a walk-only route if the trip is 3 km or less.
2. **Shade check per walk leg:**
   - Buffer the walk by 100 m and list its map cells.
   - If any cells are missing, queue **one** `PLAN` job for the trip (max 120 cells; max 60 new cells per client per day) and mark the walk legs that pass through them `shadeKnown: false`. Walk legs whose own cells are all fetched are scored straight away, even while the rest of the trip is being prepared.
   - **Don't wait.**
3. **Walk legs with shade:**
   - Score Google's walking line directly: sample it every 5 m and read each point's sun bit from the Solar files, with the hour moving forward at 1.2 m/s. This is exactly how the pilot walk was measured.
   - Also search our own shadiest path: a small graph of the shade-ready OSM segments in the corridor, with cost `length × (1 + 3.0 × sun_fraction × heatWeight)` at the start hour, kept only if it's at most 1.3× the shortest path.
   - If our path saves at least 1 sun minute (`COOLER_PATH_MIN_SAVING_MIN`), or is at least 100 m shorter than Google's walk (`SHORTER_PATH_MIN_SAVING_M`; Google's walking routes miss many campus and colony footpaths that OSM has), add a copy of the option that walks it instead.
   - Then compute `Exposure`.
4. **Transit legs:**
   - **Map Google's vehicle types:** `BUS` → BUS; `SUBWAY`, `METRO_RAIL`, `TRAM`, `MONORAIL` → METRO; `RAIL`, `HEAVY_RAIL`, `COMMUTER_TRAIN`, `HIGH_SPEED_TRAIN`, `LONG_DISTANCE_TRAIN` → RAIL; anything else → BUS.
   - **Stop shade:** match the stop to our stops within 30 m.
   - **Wait:** headway ÷ 2, or 300 s if unknown.
   - **Fare:** Google's `transitFare` is per route. Transit legs keep `fareInr: null`.
5. **E-rickshaw swap:**
   - A walk leg over 500 m, or with over 5 hot-sun minutes, whose two ends are both inside a drawn e-rickshaw zone (v1: MUJ area + Jaipur Pink Line station areas), gets an extra option.
   - Time = distance ÷ 4.2 m/s + 120 s wait. The fare comes from the zone, with the warning `FARE_ESTIMATED`.
   - A walk and its shadier copy turn into the same ride, so each ride is added once.
6. **Rank, keep the best 6 (`MAX_OPTIONS`), label them and add warnings.** While `shade.status` is `PREPARING`, some walks have no heat yet, so the options are ranked by time and fare only (`preference` counts as 0) and none is labelled `COOLEST`. Once the shade is in, the same request comes back ranked by heat.
   Warnings:
   - `HEAT_ALERT` (feels-like ≥ 40 °C)
   - `LONG_WAIT_IN_SUN` (≥ 5 min)
   - `SHADE_PREPARING`
   - `NO_SHADE_DATA` / `NO_SHADE_DATA_PARTIAL`
7. **Save:** the trip for 30 min (exact points), plus a log row rounded to ~50 m (kept 30 days).
8. **App:** if `shade.status` is `PREPARING`, it polls the job, then sends the **same request** again. Google's answer is cached, so it's fast.

**Response**

```json
{
  "tripId": "b6a1d2c3-...",
  "shade": { "status": "READY", "jobId": null },
  "conditions": { "feelsLikeC": 44.0, "heatAlert": true, "typical": true },
  "options": [
    {
      "optionId": "opt_1",
      "labels": ["RECOMMENDED", "FASTEST"],
      "departAt": "2026-05-15T13:00:00+05:30",
      "arriveAt": "2026-05-15T14:35:00+05:30",
      "durationSeconds": 5700,
      "fareInr": null,
      "exposure": {
        "walkMeters": 810,
        "walkMinutes": 11.3,
        "sunMinutes": 11.3,
        "sunMinutesHot": 11.3,
        "waitSunMinutes": 5.0,
        "shadePct": 0,
        "heatDose": 29.3,
        "feelsLikeC": 44.0
      },
      "legs": [
        {
          "mode": "WALK",
          "distanceMeters": 810,
          "shadeKnown": true,
          "coverage": "FULL"
        },
        {
          "mode": "BUS",
          "line": { "shortName": "26", "vehicle": "BUS" },
          "waitSeconds": 300,
          "stopShaded": false
        }
      ],
      "warnings": ["HEAT_ALERT", "LONG_WAIT_IN_SUN"]
    }
  ]
}
```

- **Real:** 810 m, 11.3 min, 0% shade, Bus 26. The legs are shortened here.
- **First trip in a new area:** `"shade": { "status": "PREPARING", "jobId": "9d2e..." }`, walk `sunMinutes: null`, and the warning `SHADE_PREPARING`.
- **Errors:**
  - `422 NO_ROUTE_FOUND`.
  - `502 UPSTREAM_ERROR`. If the trip is walk-only and shade-ready, return the walk instead.

### 6. `POST /routes/best-time`

**Does:** finds the departure time with the least sun. Timing is the only lever on one-path walks.

```json
{ "origin": {...}, "destination": {...}, "date": "2026-05-15", "from": "07:00", "to": "19:00", "stepMinutes": 30 }
```

```json
{
  "basis": "SHADE",
  "shade": { "status": "READY", "jobId": null },
  "slots": [
    {
      "departAt": "2026-05-15T13:00:00+05:30",
      "sunMinutes": 11.3,
      "heatDose": 29.3
    },
    {
      "departAt": "2026-05-15T17:00:00+05:30",
      "sunMinutes": 7.6,
      "heatDose": 14.9
    }
  ],
  "best": { "departAt": "2026-05-15T17:00:00+05:30" },
  "note": "Bus times are not re-checked per slot."
}
```

- **Real:** 11.3 min at 1 PM and 7.6 min at 5 PM in May, as the API measures it today (the pilot CSV gave 7.4; PRD §8 explains the gap). The doses are examples: they assume a 5 min wait and feels-like 44 °C / 41 °C.
- **How it works:** plan once (ranked by time and fare, so it's Google's own route), then re-score that option's walking lines for each slot (step 15, 30 or 60 min; max 14 h). No extra Google calls. Each stop's waiting minutes stay the same for every slot and count in the hour that ride boards.
- **No shade data:** `basis: "TEMPERATURE_ONLY"`, `sunMinutes: null`. Slots are ranked by `walkMinutes × max(heatWeight, 0.1)` while the sun is ≥ 5° up. This is labelled as an estimate.

### 7. `GET /routes/{tripId}/options/{optionId}/waypoints?language=en-IN&at=`

**Does:** gives the AR view a point every 25 m along the walk legs, plus each walk leg's last point.

```json
{
  "spacingM": 25,
  "waypoints": [
    {
      "index": 0,
      "location": { "lat": 26.84409, "lng": 75.56527 },
      "distanceFromStartM": 0,
      "legIndex": 0,
      "bearingDeg": 212,
      "inSun": true,
      "cue": "Head south along the GHS footpath"
    }
  ]
}
```

- **`inSun`** is read from the Solar files at that point for the expected arrival time. It is `null` if shade is unknown; AR draws that part grey.
- **`at`** (optional, ISO time) moves the whole trip to another start time, so `inSun` is shown for leaving then. The walk detail screen uses it for "Leave later" instead of planning the trip again.
- **`distanceFromStartM`** is measured along the walking lines, starting at 0 on the first walk leg and running on across later walk legs (rides are not counted). The last point of each leg is included, so the last waypoint of a walk sits at its full length.
- **`cue`** is English in v1; `language` is accepted for later (P2's voice code translates).
- **`cue`** is set at the start of each leg and at turns of 30° or more.
- **404** if the trip has expired.

### 8. `POST /routes/{tripId}/choice`

**Does:** records which option the user took. This is the best demand signal for the portal.

- **Body:** `{ "optionId": "opt_2" }`.
- **Returns:** `204`. The last choice wins. `404` if the trip or option is unknown.

### 19. `GET /places?q=&lat=&lng=`

**Does:** finds named places near the walker for the destination search: hostels, campus gates, colleges, food, shops and bus or metro stops that OSM knows (the `pois` and `stops` tables). Only areas the worker has fetched are searched; the app keeps Google (`query` in `/routes/plan`) as the fallback.

- **Query:** `q` (2 to 100 letters, any part of the name), `lat`, `lng` (where the walker is, or the picked start).
- **Nicknames:** `ghs` / `girls hostel` also match the girls' blocks (`G3 block`), `bhs` / `boys hostel` the boys' blocks (`B1 Block`).
- **Returns:** `{ "places": [ { "name": "G3 block", "kind": "HOSTEL", "location": { "lat": 26.8406, "lng": 75.563 }, "distanceM": 14 } ] }`, nearest first, one row per name, at most `PLACES_LIMIT`, within `PLACES_RADIUS_M`. `kind` is a `pois` kind (`HOSTEL`, `CAMPUS_GATE`, `ACADEMIC`, `FOOD`, `SHOP`, `OTHER`) or a stop kind (`BUS`, `METRO`). No match is an empty list.
- **Errors:** `400 INVALID_REQUEST` when `q` is shorter than 2 letters or a point is missing.

---

## 7. Agent and voice (P2)

### 9. `POST /agent/chat`

**Does:** answers free questions ("can I leave later?") with our real numbers, in Hindi or English.

```json
{
  "sessionId": null,
  "message": "kya 5 baje jaun to kam dhoop milegi?",
  "language": "hi-IN",
  "location": { "lat": 26.84409, "lng": 75.56527 },
  "tripId": "b6a1...",
  "speak": true
}
```

```json
{
  "sessionId": "0c7e...",
  "reply": "(Hindi text)",
  "replyLanguage": "hi-IN",
  "englishReply": "Yes. Leaving at 5 PM in May means 7.6 sun minutes, versus 11.3 at 1 PM.",
  "toolsUsed": ["find_best_time"],
  "audioUrl": "https://...",
  "fallback": false
}
```

**Steps**

1. Sarvam translates the message to English. Keep the original text.
2. Load the session's last 20 messages. Never split a tool call from its result.
3. Call Claude (`CLAUDE_MODEL`) with these tools, up to 4 rounds:

   | Tool              | Runs                                                    |
   | ----------------- | ------------------------------------------------------- |
   | `plan_route`      | endpoint 5 logic                                        |
   | `find_best_time`  | endpoint 6 logic                                        |
   | `get_conditions`  | endpoint 4 logic                                        |
   | `explain_segment` | sun minutes, shade and stop shade for one leg of a trip |

4. **Prompt rules:**
   - English, under 60 words.
   - Use only numbers from tool results.
   - Never say "safe". No medical advice.
   - If shade is `PREPARING`, say so and give timing advice. If `UNAVAILABLE`, say there is no shade data here.
5. **Number check:** every number in the reply must match a tool result within ±1. On a mismatch, retry up to 2 times; then send a template summary with `fallback: true`.
6. Sarvam translates the reply back. If `speak` is true, Bulbul TTS → S3 → `audioUrl`.
7. Save both turns.

- **Errors:**
  - `404` for an unknown session.
  - `502` if Claude fails.
  - If TTS fails: `audioUrl: null`, and the app uses browser speech.

### 10. `POST /voice/instructions`

**Does:** makes spoken directions before the walk, so they play on time with the phone in a pocket.

- **Body:** `{ "tripId", "optionId", "language" }`.
- **Returns:** `{ "steps": [ { "index": 0, "triggerAtMeters": 0, "text": "...", "audioUrl": "..." } ] }`.
- **`triggerAtMeters`** uses the same scale as the waypoints' `distanceFromStartM` (endpoint 7): metres walked from the start of the first walk leg, across all walk legs. The app plays a step when the walker's nearest waypoint reaches it.
- **How:** cues come from the waypoint cues plus shade notes ("next 100 m is shaded"). Max 30.
- **Audio** is cached in S3 by sha256(text|language|voice). A failed step gets `audioUrl: null`.

### 11. `POST /voice/tts`

**Does:** speaks a one-off message, like a heat alert.

- **Body:** `{ "text": "...", "language": "hi-IN" }`, max 500 characters.
- **Returns:** `{ "audioUrl", "cached" }`.

### 12. `POST /voice/stt`

**Does:** turns speech into text plus English.

- **Request:** multipart field `audio` (max 30 s; webm from Chrome/Android, mp4 from iPhone Safari, or wav), optional `language`.
- **Returns:** `{ "transcript": "...", "language": "hi-IN", "english": "If I go at 5, will there be less sun?" }`.
- **How:** 2 Sarvam calls. STT (`mode: transcribe`) gives `transcript` + `language`; Sarvam translate then gives `english` (skipped when the language is already English). One STT call returns only one output.
- **Note:** Sarvam's REST STT is meant for clips under 30 s; longer audio needs their batch API. It accepts WebM, MP4/M4A and WAV.

---

## 8. Portal endpoints (Cognito)

**Shared rules:**

- **Map endpoints** (14 heat-pain, 15 recommendations) need `bbox` (max 25 km²). Stats and stretch detail don't.
- **Defaults:** `month=5`, `hours=10-16` (May midday is the worst case).
- **Missing cells** in the bbox (or within 60 m of simulated items) are queued as a `PORTAL` job (max 120 cells per call). Nothing is queued outside India.
- **Walkers** come from the demand job (nightly at 02:00 IST, or by hand with `python -m app.worker.demand`). A brand-new area has none until it runs, so its pain scores are `null`.
- **If nothing in the area is ready yet:** `409 SHADE_PREPARING`.

### 13. `GET /portal/stats?from=&to=`

**Does:** shows the size of the problem: requests, average sun minutes per trip, choice rate, top origins (rounded ~50 m).

```json
{
  "requests": 1240,
  "okRequests": 1198,
  "choiceRate": 0.41,
  "avgSunMinutesPerTrip": 9.8,
  "topOrigins": [
    { "location": { "lat": 26.844, "lng": 75.5655 }, "count": 312 }
  ]
}
```

- Defaults to the last 30 days. `from` later than `to` is `400 INVALID_REQUEST`.

### 14. `GET /portal/heat-pain?bbox=&month=&hours=&limit=50`

**Does:** ranks stretches by pain score: how many people walk them in full sun.

```json
{
  "shade": { "status": "READY" },
  "type": "FeatureCollection",
  "features": [
    {
      "properties": {
        "stretchId": "str_007",
        "name": "GHS footpath",
        "lengthM": 430,
        "sunShare": 1.0,
        "walkersPerDay": 1200,
        "walkersEstimated": true,
        "painScore": 100
      }
    }
  ]
}
```

- **Real:** the ~430 m GHS footpath stretch.
- **`walkersEstimated`** is true while app trips are less than half of the estimate.

### 15. `GET /portal/recommendations?bbox=&type=TREE|SHELTER&budgetInr=`

**Does:** says where to plant trees or put shelters, ranked by people helped per rupee.

```json
{
  "recommendations": [
    {
      "rank": 1,
      "type": "TREE",
      "stretchId": "str_007",
      "count": 8,
      "positions": [{ "lat": 26.8415, "lng": 75.5642 }],
      "impact": {
        "shadePctBefore": 0,
        "shadePctAfter": 38,
        "walkersPerDay": 1200,
        "sunMinutesSavedPerDay": 3400
      },
      "costInr": 24000,
      "costEstimated": true,
      "reason": "Longest unshaded stretch on the only walk to Bus 26; fully exposed 9 AM to 4 PM in May."
    }
  ]
}
```

- **Real:** 0% shade, exposed 9 AM to 4 PM in May.
- **How:**
  - Take the top 20 stretches.
  - Trees: every 8 m along the stretch (6 m tall, 3 m crown). A stretch that would need more than 50 (the simulator's limit) gets 50, spaced evenly over its whole length. Shelter: one 3 × 6 m shelter at the nearest stop within 30 m, or else halfway along.
  - Simulate each (endpoint 16) and count only the sun saved on that stretch.
  - Pick the best by walkers × minutes saved ÷ cost.
- Costs (₹3,000 per tree, ₹60,000 per shelter) are estimates. `reason` is a template, not an LLM.

### 16. `POST /portal/simulate`

**Does:** tests virtual trees or shelters before spending money.

```json
{
  "month": 5,
  "hours": [10, 16],
  "items": [
    {
      "type": "TREE",
      "location": { "lat": 26.8415, "lng": 75.5642 },
      "heightM": 6,
      "crownRadiusM": 3
    },
    {
      "type": "SHELTER",
      "location": { "lat": 26.83887, "lng": 75.56532 },
      "widthM": 3,
      "lengthM": 6,
      "heightM": 3,
      "bearingDeg": 90
    }
  ]
}
```

```json
{
  "byHour": [{ "hour": 12, "shadePctBefore": 0, "shadePctAfter": 9 }],
  "segments": [
    { "id": "seg_412", "sunFractionBefore": 1.0, "sunFractionAfter": 0.55 }
  ],
  "sunMinutesSavedPerDay": 410,
  "approximation": true
}
```

- **How:**
  - pvlib gives the sun position on day 15 of the month.
  - The shadow is the crown (or roof), moved by `height ÷ tan(elevation)` away from the sun.
  - Points inside the shadow become shade.
- **Limits:** max 50 items. It ignores trunks, canopy gaps and growth time. Only paths within 60 m of an item are checked. A TREE needs `crownRadiusM`; a SHELTER needs `widthM` and `lengthM` (`bearingDeg` is the direction of its length).
- **`segments`** lists only the segments whose sun changed.
- **Errors:** `409` while preparing; `422 NO_SHADE_DATA`.

### 17. `GET /portal/stretches/{stretchId}`

**Does:** month × hour evidence for one stretch, ready for a proposal.

```json
{
  "stretchId": "str_007",
  "name": "GHS footpath",
  "lengthM": 430,
  "segmentIds": ["seg_412", "seg_413"],
  "sunByMonthHour": [
    [
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      0.5,
      0.75,
      0.93,
      1.0,
      1.0,
      1.0,
      1.0,
      0.96,
      0.93,
      0.85,
      0.66,
      0.39,
      null,
      null,
      null,
      null,
      null
    ]
  ],
  "walkers": { "poiEstimate": 1150, "appTrips30d": 1500, "perDay": 1200 }
}
```

- **`sunByMonthHour`** is 12 rows × 24 hours (`null` = sun below 5°).
- The row shown is May from our real walk (1 − shade%).

---

## 9. System

### 18. `GET /health`

**Does:** shows a broken service to us before a demo. **Never makes a paid call.**

```json
{
  "status": "ok",
  "db": "ok",
  "s3": "ok",
  "shade": {
    "cellsReady": 412,
    "cellsNoData": 9,
    "jobsQueued": 0,
    "oldestQueuedSeconds": 0,
    "solarCallsThisMonth": 433,
    "solarBudget": 6500,
    "workerLastSeenAt": "..."
  },
  "services": {
    "google_routes": { "lastSuccessAt": "...", "lastErrorAt": null },
    "google_solar": {},
    "overpass": {},
    "google_air": {},
    "open_meteo": {},
    "claude": {},
    "sarvam": {}
  }
}
```

- **`degraded`** if:
  - a service failed after its last success;
  - the worker hasn't been seen for 2 min;
  - a job has been queued for 5 min.
- **`503`** if the DB is down.

---

## 10. Shade data facts (Google Solar)

- **Request:** `dataLayers:get` with radius 100 m, `requiredQuality=BASE`, `view=FULL_LAYERS`. This returns a 200 × 200 m tile at 1 m per pixel.
- **Hourly shade:** 12 monthly files, each with 24 bands (local hours = IST). Bit `day − 1` is that day. **A set bit means SUN** (checked on our run).
- **Download links expire in about 1 hour,** so the worker saves all 12 monthly files to S3 at once (the DSM isn't used in v1, so it isn't downloaded).
- **GeoTIFF download limit (verified):** 180 per minute per project. The worker paces downloads at 150 a minute (`SOLAR_GEOTIFFS_PER_MINUTE`); a 429 waits a minute and retries just that file. A new cell takes about 5 s.
- **Only the worker calls Solar,** once per map cell, ever.
- **Coverage isn't guaranteed.** Google's map is an estimate, and a 404 marks the cell `NO_DATA`.
- **Cost (India):**
  - 7,000 free calls a month, then $30 per 1,000; 600 calls per minute max.
  - We stop at 6,500.
  - A 570 m test corridor at MUJ needed 12 cells (tested). An ~800 m walk should need about 12 to 20 (estimate), so roughly 400 new walks a month are free.

---

## 11. Config

**Secrets** (AWS Secrets Manager, `sunskip/prod`): `GOOGLE_API_KEY`, `ANTHROPIC_API_KEY`, `SARVAM_API_KEY`, `DATABASE_URL`, `ORIGIN_SECRET`, `CLIENT_ID_SALT`.

> The Google key shared in our chat must be **rotated** and limited to Routes, Air Quality and Solar. Never commit keys.

**Settings** (defaults are tunable guesses):

| Name                                                                                                 | Default                                   |
| ---------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `CLAUDE_MODEL`, `SARVAM_STT_MODEL`, `SARVAM_TRANSLATE_MODEL`, `SARVAM_TTS_MODEL`, `SARVAM_TTS_VOICE` | set at deploy (P2 adds them to `config.py` with the agent and voice code) |
| `USE_FAKES`                                                                                          | false (true returns the pilot numbers)    |
| `OUTSIDE_CALL_TIMEOUT_S`                                                                             | 10                                        |
| `AGENT_LIVE`, `VOICE_LIVE` (shown in `/meta` `features`; P2 turns them on)                           | false, false                              |
| `WALK_SPEED_MPS`                                                                                     | 1.2                                       |
| `HEAT_ALERT_FEELS_LIKE_C`                                                                            | 40                                        |
| `SHADE_ALPHA`, `MAX_DETOUR_RATIO`                                                                    | 3.0, 1.3                                  |
| `DEFAULT_WAIT_SECONDS`, `LONG_WAIT_IN_SUN_MIN`                                                       | 300, 5                                    |
| `WALK_ONLY_MAX_M`, `MAX_OPTIONS`                                                                     | 3000, 6                                   |
| `PLACES_RADIUS_M`, `PLACES_LIMIT`                                                                    | 20000, 8                                  |
| `SWAP_MIN_WALK_M`, `SWAP_MIN_HOT_SUN_MIN`                                                            | 500, 5                                    |
| `ERICKSHAW_SPEED_MPS`, `ERICKSHAW_WAIT_SECONDS`                                                      | 4.2, 120                                  |
| `WAYPOINT_SPACING_M`                                                                                 | 25                                        |
| `TREE_SPACING_M`, `TREE_COST_INR`, `SHELTER_COST_INR`                                                | 8, 3000, 60000                            |
| `CORRIDOR_BUFFER_M`, `MAX_CELLS_PER_JOB`, `MAX_NEW_CELLS_PER_CLIENT_PER_DAY`                         | 100, 120, 60                              |
| `SOLAR_MONTHLY_CALL_BUDGET`, `WORKER_SOLAR_CONCURRENCY`                                              | 6500, 4                                   |
| `OVERPASS_URLS` (tried in order; the main server is often busy)                                      | overpass-api.de, then maps.mail.ru        |
| `COOLER_PATH_MIN_SAVING_MIN`, `SOLAR_GEOTIFFS_PER_MINUTE`                                            | 1.0, 150                                  |
| `SHORTER_PATH_MIN_SAVING_M`                                                                          | 100                                       |
| `S3_BUCKET`, `AUDIO_URL_TTL_S`                                                                       | (bucket name), 3600 (P2)                  |
| `MAX_SHADE_MAP_KM2`, `POLL_AFTER_SECONDS`                                                            | 1, 3                                      |
| `ORIGIN_SECRET_CHECK`                                                                                | true (false only locally)                 |
| `MAX_PORTAL_BBOX_KM2`, `SIMULATION_REACH_M`                                                          | 25, 60                                    |
| `TREE_HEIGHT_M`, `TREE_CROWN_RADIUS_M`, `SHELTER_WIDTH_M`, `SHELTER_LENGTH_M`, `SHELTER_HEIGHT_M`    | 6, 3, 3, 6, 3                             |
| `STRETCH_SUN_DIFF`, `DEMAND_RADIUS_M`, `DEMAND_DECAY_M`                                              | 0.2, 400, 150                             |

More settings for the database and worker are in `schema.md` §8.

---

## 12. Open questions (current defaults)

| Question                        | Default                                                             |
| ------------------------------- | ------------------------------------------------------------------- |
| Places outside India            | Not in v1                                                           |
| Auto-rickshaw as a planned mode | v2                                                                  |
| E-rickshaw fares                | Formula per zone only (no time to collect real fares before 11 Oct) |
| Self-host Overpass              | No (not before 11 Oct); preload demo areas instead                  |
| Languages                       | English, Hindi, Hinglish                                            |
| Portal roles                    | One role                                                            |
