# SunSkip design

The look and behaviour of the student app (`app/`) and the officials portal (`portal/`, section 12).

- **Live prototype:** https://sunskip-ui.vercel.app (tap through it on a phone)
- **All screens as images:** `SunSkip UI screens.pdf` (25 screens, ask Suryansh for the file)
- **Numbers in the prototype are real** API data for 15 May: MUJ main gate to Mansarovar Metro Station, and the 811 m walk to the Bus 26 stop.

---

## 1. Direction

**A map-first transit app where the main number is minutes in direct sun, not travel time.**

- One full-screen map sits behind Home, Results, Navigate and the Shade map. Content sits on a white bottom sheet over it, like Google Maps or Citymapper.
- Every screen has one main number or action; everything else stays quiet.
- Blue always means shade and orange always means sun. Red is only for heat alerts and errors.
- Lists use thin dividers, not cards inside cards. Only route options are cards.
- Readable in strong sunlight: light background, strong text contrast, large tap targets.

---

## 2. Colours

Put these at the top of `index.css` (or in `tailwind.config` `theme.extend.colors`).

| Token | Hex | Use |
|---|---|---|
| `paper` | `#F4EFE8` | Page background, map background |
| `sheet` | `#FFFFFF` | Bottom sheets, cards, inputs |
| `sunken` | `#F1EBE3` | Chips, search field, secondary buttons |
| `ink` | `#1F1A16` | Text, main buttons, bus chips |
| `muted` | `#6B5F55` | Secondary text |
| `line` | `#E6DDD2` | Dividers and borders |
| `shade` | `#2F80ED` | Shade fills: strip cells, map lines, the selected hour bar |
| `shade-text` | `#1A5FC4` | Text on light backgrounds that means shade (labels, links) |
| `shade-tint` | `#E4EEFC` | Light blue backgrounds |
| `shade-strong` | `#1E6FD9` | Blue backgrounds with white text (contrast 4.86:1) |
| `sun` | `#F2994A` | Sun fills only. **Never use it as text** (contrast 1.85:1) |
| `sun-text` | `#9A4D0E` | Text that means sun or waiting in the sun |
| `sun-tint` | `#FDEBDB` | Light orange backgrounds |
| `alert` | `#B91C1C` | Heat alert chip, errors, end-walk button |
| `alert-tint` | `#FBE6E3` | Heat line background |
| `unknown` | `#B9AFA6` | Unknown sun (`null`) on strips and map |
| `metro` | `#C2185B` | Jaipur Metro Pink Line chips and legs |

Rules:

- White text on `#2F80ED` fails contrast (3.87:1). Use `shade-strong` for blue buttons and tags.
- Orange `#F2994A` with dark text is fine; white text on orange is not.
- The CLAUDE.md colours (shade `#2F80ED`, sun `#F2994A`, alert `#B91C1C`) stay as they are; the others above are added roles.

---

## 3. Type

**Font:** [Mona Sans](https://fonts.google.com/specimen/Mona+Sans) (Google Fonts, SIL Open Font License). It is variable in width and weight.

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Mona+Sans:wdth,wght@75..125,200..900&family=Noto+Sans+Devanagari:wght@400;600&display=swap" rel="stylesheet">
```

```css
font-family: "Mona Sans", "Noto Sans Devanagari", system-ui, sans-serif;
```

Noto Sans Devanagari is there for Hindi text (agent replies, spoken-direction captions); Mona Sans has no Hindi letters.

| Role | Size | Weight | Width (`font-stretch`) |
|---|---|---|---|
| Hero number (sun minutes) | 84 px | 760 | 125% |
| Card number | 34 px | 760 | 125% |
| Other big numbers (nav stats, %, °C) | 24–56 px | 720–760 | 125% |
| Screen title | 22 px | 700 | 112% |
| Section heading | 17 px | 650 | 100% |
| Navigation instruction | 21 px | 700 | 100% |
| Body | 15–16 px | 400 | 100% |
| Small labels, captions | 13–14 px | 400–650 | 100% |

- Nothing smaller than 13 px (the map credit is the only 12 px text).
- Body line height 1.45; Hindi text 1.6.
- The wide 125% width is only for numbers. It is what gives the app its look; don't use it on sentences.

---

## 4. Shapes, spacing and controls

| Thing | Value |
|---|---|
| Side padding | 16–20 px |
| Corners: buttons, inputs, chips | 14 px (small chips 8–12 px) |
| Corners: route cards | 16 px |
| Corners: top of bottom sheets | 22 px |
| Main button | ink background, white text, 56 px tall, weight 650 |
| Secondary button | `sunken` background, ink text |
| Floating map buttons | 46 px white circles with a soft shadow |
| Tap targets | at least 44 px, mostly 48–56 px |
| Dividers | 1 px `line` |
| Shadows | only on things floating over the map (sheet, top bar, chips) |

**One control grammar:** every button presses in to 97% on touch (80 ms) and springs back (250 ms). Segmented controls (Leave now / Leave at / Arrive by, Map / AR) use a sliding white or ink pill that moves to the chosen option in 300 ms.

---

## 5. Icons

**[Phosphor Icons](https://phosphoricons.com)**, MIT licence. Use the **Bold** weight everywhere, and **Fill** only for the mic, the speaker, the start-walking arrow and the big arrow backup.

```bash
npm install @phosphor-icons/react   # listed in TRD §2.1
```

```tsx
import { Sun } from "@phosphor-icons/react";
<Sun size={20} weight="bold" />
```

| Where | Icon |
|---|---|
| Back, close | `ArrowLeft`, `X`, `XCircle` (fill) |
| Lists, links | `CaretRight`, `CaretDown` |
| Search, location | `MagnifyingGlass`, `Crosshair`, `MapPin` |
| Walk, bus, metro, e-rickshaw | `PersonSimpleWalk`, `Bus`, `TrainSimple`, `Taxi` |
| Waiting at a stop, recents, time | `Clock`, `ClockCounterClockwise`, `CalendarBlank`, `HourglassMedium` |
| Arrive | `FlagCheckered` |
| Sun, shade, heat, air | `Sun`, `Tree`, `ThermometerHot`, `Wind`, `Warning` |
| Map, AR | `MapTrifold`, `CubeFocus` |
| Start walking, directions | `NavigationArrow` (fill), `ArrowUp` (bold; fill for the arrow backup) |
| Voice and Ask | `Microphone` (fill), `SpeakerHigh` (fill), `SpeakerSlash`, `Waveform`, `ChatCircleDots` |
| Errors and fallbacks | `Signpost` (no route), `WifiSlash` (offline), `CloudSlash` (no shade data), `CameraSlash` (no camera) |

Icon size is about 1–1.25× the text next to it (20–22 px in lists, 17 px in mode chips).

---

## 6. Map

**Library:** plain `maplibre-gl` v5 (TRD §2.1). **Tiles:** OpenFreeMap **Positron** style, free and no key: `https://tiles.openfreemap.org/styles/positron`. Keep "© OpenFreeMap © OpenStreetMap" visible just above the sheet.

The grey Positron style is warmed after it loads, so the sun and shade lines stand out:

```ts
const BASEMAP: Record<string, [string, string]> = {
  background: ["background-color", "#F4EFE8"],
  park: ["fill-color", "#E3EAD6"],
  water: ["fill-color", "#C9DCEA"],
  landuse_residential: ["fill-color", "#EFE8DF"],
  landcover_wood: ["fill-color", "#DCE6CF"],
  building: ["fill-color", "#E8DFD3"],
  highway_path: ["line-color", "#FBF7F1"],
  highway_minor: ["line-color", "#FFFFFF"],
  highway_major_casing: ["line-color", "#DDD2C5"],
  highway_motorway_casing: ["line-color", "#DDD2C5"],
  "highway-name-minor": ["text-color", "#7A6E64"],
  "highway-name-major": ["text-color", "#7A6E64"],
  label_village: ["text-color", "#3A3029"],
  label_town: ["text-color", "#3A3029"],
  label_other: ["text-color", "#5A4E45"],
};
map.on("load", () => {
  for (const [layer, [property, value]] of Object.entries(BASEMAP)) {
    if (map.getLayer(layer)) map.setPaintProperty(layer, property, value);
  }
});
```

**Our layers** (GeoJSON line layers added on top; changing the hour only calls `setData`, the map never reloads):

| Layer | Data | Colour | Width |
|---|---|---|---|
| Shade streets | `/shade/segments` features | `sunFraction ≥ 0.5` → `#F5B47E`, below → `#86B4F4`, `null` → `#CFC6BD` | 2 px at zoom 14 → 7 px at 18 |
| Walk casing | walk pieces | `#FFFFFF` | 7 → 16 px |
| Walk | waypoints, one piece per pair | `inSun: true` → `#F2994A`, `false` → `#2F80ED`, `null` → `#B9AFA6` | 4 → 10 px |
| Bus or metro ride | leg `polyline` | `#3A302A` | 3 px at zoom 11 → 8 px at 16 |
| E-rickshaw ride | leg `polyline` | `#3A302A`, dashed `[1.2, 1.2]` | 3 → 7 px |

Markers: start = white circle with a 3.5 px ink ring; end = ink circle with a white centre; you (navigation) = 26 px blue dot, white 4 px border, light blue heading cone, rotated with the map.

Camera per screen:

- **Home:** fit the area around you, zoom up to 15.6, padding for the sheet.
- **Results / option:** fit every leg of the chosen option; sheet covers the bottom 66%.
- **Walk detail:** fit the walk, max zoom 16.6.
- **Navigate:** centre on you, zoom 17.4, pitch 52°, bearing = direction of walking (walking direction always points up).
- **Shade map:** fixed view of the prepared area, zoom 15.6.

---

## 7. Screens

All screens open at 360–430 px wide, one column. Each lists the API data it uses.

| # | Screen | What it shows | Data |
|---|---|---|---|
| 01 | **Home** | Map of shade around you ("98% of streets near you in sun" + legend), heat chip, "Where to?" with a mic button, from-line, Leave now / Leave at / Arrive by, "Find routes with less sun", recent trips | `/conditions`, `/shade/segments` |
| 02 | Home, first time | "No trips yet. Places you search for will show here." | local recents |
| 03 | **Search destination** | Search field, from-line with Change, place suggestions, "Pick the place on the map" | needs an autocomplete source (not in our API yet) |
| 04 | **Leave at / Arrive by** | Bottom sheet with day and hour chips; Leave at shows each hour's walking sun minutes, the least-sun hour tinted blue | `/routes/best-time` slots |
| 05 | **Heat details** | Feels-like big number, air temperature, Heat alert pill, feels-like bars 7 AM–7 PM (red at 40 °C or more), air quality (NAQI) or "Unknown for this date", sources | `/conditions` |
| 06 | Finding routes | Three grey loading cards with a shimmer | — |
| 07 | **Preparing shade data** | Routes show at once, sorted by time, with "13 of 45 map areas ready" and a progress bar; ranked routes swap in by themselves | `/routes/plan` `shade.status = PREPARING`, poll `/shade/jobs/{id}` every 3 s, then plan again |
| 08–09 | **Route options** | Heat line, "6 ways to go · Best match first", one card per option | `/routes/plan` options |
| 10–11 | **Option detail** | Labels, big walking-sun number, time · metres on foot · fare, waiting-in-sun line, legs timeline, "Best time to leave", "Take this route" | one option's legs + `/waypoints` |
| 12–13 | **Walk detail** | Big sun number, metres, minutes, % shade, sun/shade strip, "Leave later" hour bars (tap to recolour), e-rickshaw and shadier path rows, "Start walking" | plan + `/routes/best-time` |
| 14 | **Navigate (map)** | Ink instruction banner ("Continue west · 100 m, then turn left") with speaker toggle, Hindi caption of what is spoken, "Shade for the next 25 m, then sun", sun minutes left, minutes to go, arrival, progress strip, Map / AR switch, end walk | `/waypoints` (cue, inSun, bearing), `/voice/instructions` |
| 15 | **Navigate (AR)** | Camera view, chevrons on the path (blue in shade, orange in sun), tags where shade ends, recalibrate, "Use arrow" | `/waypoints` (P3: locar + three.js) |
| 16 | **Arrow backup** | One big arrow (blue in shade, orange in sun), distance, instruction, "The camera isn't available…", Try AR again / Map | `/waypoints` |
| 17 | **Best time to leave** | Best hour note with the next two, bar per hour, "now" marker, note | `/routes/best-time` |
| 18–19 | **Shade map** | % of streets in sun, your walk's sun minutes at that hour, hour slider 7 AM–7 PM, legend | `/shade/segments` per hour |
| 20–22 | **Ask SunSkip** | Listening (pulsing mic, words as you say them), thinking ("Checking the best time to leave…"), answer in Hindi + English with Play and "Checked: best time to leave", suggestion chips, text input + mic | `/agent/chat`, `/voice/stt`, `/voice/tts` (P2) |
| 23 | No route found | "We couldn't find a way between these places…", pick on map, change destination | `422 NO_ROUTE_FOUND` |
| 24 | Can't reach SunSkip | "Check your internet connection and try again. Your search is kept." + Try again | network error / `5xx` |
| 25 | No shade data here | Banner: minutes in sun unknown; times, fares and best time still work | `shade.status = UNAVAILABLE`, warning `NO_SHADE_DATA` |

### Route option card

```
Recommended · Coolest                 ← labels, shade-text 13 px bold
[E-rick] › [26] › [walk] › [7] › [walk]  ← mode chips
4.7                     2 h 1 min      ← walking sun (34 px wide) · duration
min walking in sun      ₹65 est. · 341 m on foot
🕒 + 10 min waiting at stops in the sun ← only if waitSunMinutes > 0, sun-text
```

- Mode chips: walk = icon only on `sunken`; bus = ink chip with white line number; metro = `metro` chip "Metro"; e-rickshaw = `sunken` chip "E-rick".
- The first card (RECOMMENDED) gets a 2 px ink border.
- Walking sun (`exposure.sunMinutes`) and waiting sun (`exposure.waitSunMinutes`) are shown **separately, never added up**.
- `fareInr` + warning `FARE_ESTIMATED` → "₹65 est."; `null` → "fare unknown".
- Label text: RECOMMENDED → "Recommended", FASTEST → "Fastest", CHEAPEST → "Cheapest", COOLEST → "Coolest".

### Legs timeline (option detail)

One row per leg, with a 36 px round icon and a line joining them (ink for rides):

- **Wait** (before a ride, when `waitSeconds`): "Wait 5 min at Manipal University Jaipur" / "the stop has no shade" (`stopShaded: false`, sun-text), "the stop has shade" (`true`), "stop shade unknown" (`null`).
- **Walk:** "Walk 810 m" / "11 min · 11.3 min in sun" + a small sun/shade strip from the waypoints of that leg. The first walk opens the walk detail.
- **Bus:** "Bus 26 to Kamala Nehru Nagar" / "1 h 1 min · board at 1:22 PM".
- **Metro:** "Pink Line to Mansarovar".
- **E-rickshaw:** "E-rickshaw to Manipal University Jaipur" / "5 min · ₹20, estimated".
- **Arrive:** "Mansarovar Metro Station" / "Arrive 3:12 PM".

---

## 8. Motion

Three kinds of movement. All of it turns off under `prefers-reduced-motion`.

1. **Feedback on the main action.** Buttons press in to 0.97. "Find routes" shows three pulsing dots, then the loading cards, then the Preparing card, then the ranked list.
2. **A change you can see the source of.**
   - Tapping an hour: the blue highlight slides to it (320 ms), the big number rolls to the new value (420 ms, ease-out), and the walk strip and the map line recolour piece by piece from start to stop, 14 ms apart. Colours flip instantly per piece; a blue-to-orange fade passes through grey and looks muddy.
   - Map → AR: the camera view opens as a circle growing out of the AR button (500 ms). Chevrons march forward along the path.
3. **First entry.** The sheet rises (420 ms), the number lands, the strip fills in walking order (9 ms apart), the route draws itself on the map, then the cards rise one after another (45 ms apart).

Easing: `cubic-bezier(.2,.8,.2,1)` for everything that enters or moves.

---

## 9. Words

- **Never write "safe".** No medical advice. Say "minutes in direct sun", not "comfort".
- **Unknown is "unknown", never 0.** A `null` sun number shows as "unknown" (smaller, muted).
- Numbers: one decimal, round half up (11.25 → 11.3). Fares in ₹ with "est." when estimated.
- Times as "1:22 PM", hours as "5 PM", durations as "2 h 13 min".
- Buttons say what happens: "Find routes with less sun", "Take this route", "Start walking", "Try again".
- Error text says what went wrong and what to do; no apologies.
- Every number on screen comes from the API or an api.md formula.

---

## 10. States every screen needs

| State | How it looks |
|---|---|
| Loading | Grey cards or bars with a slow shimmer; short line saying what is happening |
| Preparing shade data | Real routes at once + progress card; swap in automatically |
| Empty | One line saying what will appear and how ("No trips yet…") |
| No route | Signpost icon, message, pick-on-map button |
| Offline / server error | Wi-Fi icon, message, Try again; keep what the user typed |
| No shade data | Banner; sun numbers show "unknown"; everything else works |
| AR not possible | Arrow backup screen |
| Agent | Listening, thinking, answer, and (if `fallback: true`) the template answer |

---

## 11. Accessibility

- Text contrast at least 4.5:1 (all tokens above pass on their intended backgrounds).
- Visible focus ring: 3 px `#2F80ED` outline, 2 px offset.
- Icon-only buttons have an `aria-label` ("Back", "Show my location", "Mute spoken directions").
- Colour is never the only signal: sun/shade also appear as words ("Shade for the next 25 m").
- Respect `prefers-reduced-motion`.

---

## 12. Portal (officials)

**Direction: "Signal".** Clear like a transit authority sign: black top bar, big condensed headings, stretches grouped into severity bands, square controls. Same font, icons and map tiles as the app, but its own palette and shapes, because officials triage a list rather than plan one trip. Desktop-first (1280 px and up). The prototype uses real API data for two areas: MUJ and the Bus 26 stop, and Mansarovar Metro.

**Layout:**
- **No sidebar.** A 56 px black bar holds the logo, the four sections as full-height tabs (the active one turns white), the area picker on the right, then the signed-in team and sign out.
- **Below the bar:** the map on the left and a 560 px white side panel on the right, split by a 2 px black rule.
- **Each panel:** a big condensed heading, a one-sentence finding with real numbers, a strip of control cells, then the list.
- **Stretch evidence:** a full-width page that prints on A4.

**Type:** Mona Sans throughout. Headings and big numbers use width 75% (condensed), weight 800, and headings are uppercase (64 px panel headings, 84 px page titles, 22–96 px numbers). Body text is 15 px at normal width.

**Shapes:** no rounded corners. Buttons are square: main buttons are black, secondary buttons are white with a 2 px black inset border. Map overlays are white boxes with a 2 px black border. Rows have 1 px `#E3DCD3` dividers, and sections have 2 px black rules.

**Colours (portal):**

| Token | Hex | Use |
|---|---|---|
| ink | `#141110` | Top bar, text, main buttons, rank tags |
| paper | `#FFFFFF` | Panels; `#F4F0EB` for hover and the open row |
| severe | `#B91C1C` | Pain 70+: map line, band, number |
| high | `#E8590C` (map) / `#C2410C` (band and text) | Pain 40–69 |
| moderate | `#F2994A` (map, band with ink text) / `#9A4D0E` (text) | Pain 20–39 |
| low | `#E9B98B` (map, band with ink text) / `#6B5F55` (text) | Pain under 20 |
| unknown | `#D8D1C7` | `painScore` is `null` |
| tree | `#3D6A2B` | Tree pins and icons |
| shade | `#2F80ED` | Shade after a plan, bars, changed paths |
| sun grid ramp | `#2F80ED` → `#C9DDF7` → `#FBE3CC` → `#F2994A` → `#D9731F` | Evidence grid cells, sun fraction 0 → 1; `null` is a light hatch |

**Map:** Positron, recoloured to neutral greys (`background #F7F5F2`, `building #E7E2DA`). Stretch lines use the band colour, and their width steps up with the band. Square black rank tags (1–10) sit at each top-ten stretch's midpoint; hovering a tag or a row highlights the stretch in black.

**Screens:**

| # | Screen | What it shows | Data |
|---|---|---|---|
| P1 | **Sign in** | Real heat-pain map of MUJ on the left; black panel with "WHERE PEOPLE WALK IN THE SUN.", the three things the portal does, "Sign in with your city account" (Cognito hosted login) | Cognito |
| P2 | **Heat pain** | Finding sentence (people a day on the top 10, how many are 90%+ in sun); cells: Month, Hours (10 AM – 4 PM or By hour, with a 7 AM – 6 PM slider for May), Export CSV; list grouped into Severe / High / Moderate / Low bands (count and people a day per band), each row: rank, name or "Unnamed path", % in sun, length, people a day, pain; map with band-coloured lines and rank tags; hover ↔ highlight; click opens the evidence; "Part of this area is still being prepared" notice | `/portal/heat-pain` (`month`, `hours`) |
| P3 | **Trees and shelters** | Trees / Shelters cells; budget cell (₹, Indian digit grouping) with ₹50,000 · ₹1 lakh · ₹2 lakh · ₹5 lakh cells; plan total when a budget is set; one row per recommendation: stretch, count, cost (est.), shade before → after bar, people a day, sun-minutes saved a day on the stretch; the open row shows the reason, "Try in 3D" and "Evidence"; map shows that row's pins large and the rest small | `/portal/recommendations` (`type`, `budgetInr`) |
| P4 | **Stretch evidence** | Name, place, length, path pieces, id; four numbers (people a day, % in sun May 10–4, hours a day 90%+ in sun in May, pain rank); 12 months × 24 hours sun grid with May 10 AM–4 PM outlined and a hover read-out; who walks here (nearby places, SunSkip trips, total); a printable line drawing of the stretch with a 50 m scale and north arrow; sources; "Print or save as PDF" (A4 landscape) | `/portal/stretches/{id}` + heat-pain row |
| P5 | **What-if simulator** | 3D map (pitch 60°, 3D buildings); tools: select and move, add tree, add shelter, reset view; trees are a trunk and three stacked crown discs, shelters four posts and a blue roof, both sized from the request fields; drag to move, click a path to add; side panel: item chips with cost, an editor for the selected item (tree: height, crown radius; shelter: width, length, roof height, turn), "Run simulation"; result: sun-minutes saved a day on paths within 60 m (counts up), shade % before vs after per hour (bars grow), changed paths recolour on the map with a Before / After switch, approximation note | `/portal/simulate` |
| P6 | **Usage** | Last 7 / 30 / 90 days; trips planned, % that got routes, % that picked a route, average minutes walking in sun; top start points (rounded ~50 m) as a list and as circles on the map; outside-India points labelled | `/portal/stats` |

**States:** loading (shimmer rows), part of the area preparing (banner + progress, list still shows), nothing ready yet (`409`: hourglass, "Getting this area ready", progress), can't reach SunSkip (Try again, filters kept), no plan fits the budget ("The cheapest tree plan here costs ₹…", Clear budget), no trips in the dates.

**Motion:** panel content fades up 10 px on each screen change; hovering a row highlights the stretch and opening a recommendation flies the map to it; entering the simulator tilts the camera into 3D; new trees and shelters grow out of the ground; after Run the paths turn from before to after colours while the hour bars grow and the big number counts up. All of it is off under `prefers-reduced-motion`.

**Words:** "people a day" (always marked estimate), "sun-minutes saved a day", "in sun", "Unnamed path" for OSM paths with no name, ₹ amounts with "est.", never "safe".

## 13. Assets and credits

| Asset | Source | Licence |
|---|---|---|
| Mona Sans | Google Fonts / GitHub | SIL Open Font License |
| Noto Sans Devanagari | Google Fonts | SIL Open Font License |
| Phosphor Icons | phosphoricons.com | MIT |
| Map tiles and style | OpenFreeMap (Positron), data © OpenStreetMap | ODbL; attribution must stay visible |
| AR sample photo (prototype only) | Wikimedia Commons, "A footpath on Walker's Road" | CC BY 3.0, credit shown on screen; the real app uses the live camera |
