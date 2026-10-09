# SunSkip: Product Requirements (v1)

> **SunSkip: Skip the sun, not the trip.** (Formerly ChhaonPath.)
>
> - **Read in this order:** `PRD.md` (what and why) → `TRD.md` (how we build it) → `api.md` (endpoints) → `schema.md` (database) → `SunSkip_Team_Handbook.pdf` (who builds what).
> - **Labels:** **(real)** = measured by us; **(verified)** = checked against a public source; everything else is an example or a tunable guess.

---

## 1. What we're building

**Google Maps for walking in the heat, anywhere in India.**

- **App:** enter any start and destination. We show the walking + bus/metro/e-rickshaw route with the **least direct sun**, and the **best time to leave**.
- **Portal:** shows officials **where trees and shelters would help the most people**.

**Hackathon fit:**

- **Format:** online, software only. **Submission deadline: Sun 11 Oct 2026, 23:59 IST.** Build window: 8 to 11 Oct (about 3.5 days).
- **AWS:** we must use at least one AWS product; we use seven.
- **Theme 02, Heat:** we cut heat exposure on real walks.
- **Theme 03, Public transport:** we fix the hot walk and the hot wait that push people away from buses.
- **Theme 01, Air:** the heat banner shows air quality (NAQI).

---

## 2. The problem

- In Indian summers, the walk to and from the bus or metro is the part of a trip spent in full sun. In Jaipur, the average May daily high is **40.5 °C** (IMD, verified).
- At midday the sun is almost overhead, so **buildings give almost no shade**. Only trees, shelters and timing help.
- Google Maps shows the shortest walk, not the coolest. Officials have no data on where shade is missing.

**Our proof (real), from our pilot walk at MUJ, Jaipur:**

- **The walk:** 810 m from (26.84409, 75.56527) to the Bus 26 stop, the main bus out of campus. It runs often.
- **Data:** Google shade data every 5 m: 163 points, no gaps.

| May 15, hour (IST) | 7   | 8   | 9    | 10       | 11       | 12       | 13       | 14   | 15   | 16  | 17  | 18  |
| ------------------ | --- | --- | ---- | -------- | -------- | -------- | -------- | ---- | ---- | --- | --- | --- |
| Shade %            | 50  | 25  | 7    | **0**    | **0**    | **0**    | **0**    | 4    | 7    | 15  | 34  | 61  |
| Minutes in sun     | 5.6 | 8.5 | 10.6 | **11.3** | **11.3** | **11.3** | **11.3** | 10.9 | 10.6 | 9.6 | 7.4 | 4.4 |

- **Leaving at 5 PM instead of 1 PM** cuts direct sun from **11.3 to 7.4 minutes**.
- **~635 m of the walk (127 of 163 points) is in sun every hour from 9 AM to 4 PM.**
- **The worst stretch is ~430 m with no shade** (86 points in a row) on the GHS footpath. It is our first tree recommendation.

**Why buildings don't help (verified with pvlib at MUJ):**

- On May 15 the sun peaks at **82°** (12:24 IST), so a 10 m building throws only a **1.4 m** shadow at noon.
- On Oct 7 the same building throws 6.3 m at noon. That's why October walks look shadier than May.

---

## 3. Competitors (verified)

| Product                    | Where                       | What's missing for India                   |
| -------------------------- | --------------------------- | ------------------------------------------ |
| Google Maps                | India                       | No sun or shade at all                     |
| Cool Walks                 | One Barcelona neighbourhood | Not India; walking only                    |
| HeiGIT shade routing       | 80 German cities            | Not India; walking only                    |
| inShade (mobile app)       | 100+ countries              | Walking only; no transit or heat weighting |
| Cool Routes (ASU)          | ASU campus, USA             | One campus                                 |
| Cool Routes (Georgia Tech) | 10 US cities                | Not India; no transit                      |

**What only we do:**

1. India-first and works anywhere in India.
2. Weights sun by temperature (heat dose), not just shade.
3. Mixes transit: shady walks + bus/metro + e-rickshaw, and counts **time waiting at sunny stops**.
4. Best time to leave, plus a Hindi/English voice agent.
5. A portal that turns this into tree and shelter decisions.

---

## 4. Users

| User                                                                          | Needs                                            | Uses      |
| ----------------------------------------------------------------------------- | ------------------------------------------------ | --------- |
| **Anyone walking to transit in India**                                        | Least sun, best time, e-rickshaw option          | App       |
| **Students** (pilot: MUJ/GHS)                                                 | Bearable walk to the bus                         | App       |
| **Hindi speakers**                                                            | Ask and hear directions in Hindi                 | App voice |
| **City officials** (main pitch user; campus and transit teams can use it too) | Where to plant trees or put shelters, with proof | Portal    |

**Pitch angle:**

- **The portal is the impact story,** because many people can't change their travel time.
- **The app is the daily product,** and it feeds demand data to the portal.

---

## 5. Scope

**In v1:**

- Any trip in India, ranked by heat.
- New areas prepared on demand.
- Best time to leave.
- Shade map.
- Heat banner.
- E-rickshaw swaps (only in zones we draw).
- Agent + Hindi voice.
- Portal for city officials (heat-pain map, recommendations, simulator, stats).
- AR walk view (**must-have**).

**Not in v1:**

- Places outside India.
- Surveys, complaints, user reports, or field checks of the shade data (we rely on Google's data in v1).
- User accounts.
- Auto-rickshaw as a planned mode.
- Native app.
- Saved simulator plans.
- Estimating shade where Google has none.
- Any "safe" or "comfort" claims. We measure **minutes in direct sun**, not hot walls, wind or humidity.

---

## 6. How "anywhere" works

1. **The map is cut into small cells**, about 150 × 140 m in Jaipur.
2. **First trip in a new area:**
   - We show normal routes **immediately**, marked "Preparing shade data…".
   - A background worker fetches Google shade data for the cells along each walk, plus OpenStreetMap walkways. A 570 m test corridor at MUJ needed 12 cells (tested); an 800 m walk should need about 12 to 20 (estimate).
3. **About a minute later** (estimate), the app re-plans by itself and shows the shadiest route.
4. **After that,** every trip through those cells is instant. Shade data is kept forever.
5. **No Google shade data there?** We still give the route and the best time from sun angle and temperature. Sun minutes show as "unknown".
6. **Cost guard (verified):**
   - Google gives 7,000 free shade calls a month in India; after that it's $30 per 1,000.
   - We stop at 6,500, which is about 400 brand-new walks a month. Repeat walks are free.
7. **Demo:** we preload MUJ and the Jaipur Pink Line metro station areas (e.g. Mansarovar, Civil Lines, Sindhi Camp, Chandpole) so the demo never waits.

---

## 7. Features

**Priority:** P0 = must have for the demo · P1 = should have.

**App (`sunskip-app`)**

| Feature                              | Pri    | Done when                                                                                                                       |
| ------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Trip planner, anywhere in India      | P0     | Options with sun minutes per walk; under 3 s; never waits for shade                                                             |
| "Preparing shade data" state         | P0     | Shows progress, polls every 3 s, swaps in the new routes automatically                                                          |
| Fastest / cheapest / coolest card    | P0     | Time, ₹ (or "unknown"), minutes in sun (or "unknown")                                                                           |
| Best time to leave                   | P0     | Pilot shows **11.3 min at 1 PM vs 7.4 at 5 PM** (the API gives 7.6 at 5 PM, see §8)                                              |
| Shade map                            | P0     | Paths coloured by sun for any hour                                                                                              |
| Heat banner                          | P0     | Temp, feels-like, NAQI; alert at feels-like 40 °C                                                                               |
| E-rickshaw swap                      | P1     | Only in drawn zones (MUJ + Jaipur metro station areas); fare from a formula, marked as estimate (no time to collect real fares) |
| "I'm taking this one"                | P1     | Choice logged anonymously                                                                                                       |
| Agent (text)                         | P1     | Hindi/English, under 60 words, only real numbers, never says "safe"                                                             |
| Voice directions and voice questions | P1     | Hindi audio works; browser speech as backup                                                                                     |
| AR walk view                         | **P0** | Arrows on the path (blue = shade, orange = sun) on one Android + one iPhone; 2D arrow backup                                    |

**Portal (`sunskip-portal`)**

| Feature                        | Pri | Done when                                                         |
| ------------------------------ | --- | ----------------------------------------------------------------- |
| Heat-pain map                  | P0  | Stretches ranked by people × sun × length, for any area           |
| Tree / shelter recommendations | P0  | First real one: the ~430 m GHS footpath                           |
| Stretch evidence               | P0  | 12 months × 24 hours of sun for one stretch, ready for a proposal |
| Usage stats                    | P1  | Trips, average sun minutes, top origins                           |
| What-if simulator              | P1  | Shade before vs after virtual trees                               |

**Platform:** shade worker + cost guard (P0), `/health` (P0), preload script (P0), nightly demand job (P1).

---

## 8. Success

**For the hackathon:**

- **Pilot numbers match:** the deployed API shows 11.3 min at 1 PM for the May pilot walk, and every hour within ±0.2 of the pilot table (7.6 at 5 PM vs 7.4).
  - Measured locally (9 Oct) and on the deployed API (10 Oct): **11.3 at 1 PM** exactly; **7.6 at 5 PM**. Every hour is within ±0.2 of the table. The shade files agree with the pilot CSV on all 163 points every hour; the small gap is because the line Google returns today sits up to 1.4 m off the pilot's points.
- **"Anywhere" works live:** a trip in a city we never preloaded goes from "preparing" to the shadiest route within about a minute.
- **AR works live:** arrows follow a real route on one Android and one iPhone.
- **Fast:** plan under 3 s, agent under 15 s. Everything is under API Gateway's 29 s limit (verified).
- **Hindi voice** works end to end.
- **`/health` is green** before the demo.

**After launch:** sun minutes saved per trip, time to prepare a new area, share of trips already cached, Solar calls vs budget.

---

## 9. Main risks

| Risk                                                             | Fix                                                                     |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Google shade data missing in some places                         | Fall back to route + best time; test demo areas early                   |
| Costs grow with new areas                                        | Monthly cap (6,500), per-user cap, max 120 cells per job                |
| First trip in a new area feels slow                              | Show routes at once, progress bar, auto refresh, preload demo areas     |
| Overpass (OSM) is slow or down                                   | One call at a time, retries, data kept forever                          |
| Tree shade overstated (Google treats canopies as solid)          | Say clearly that shade comes from Google's model; no field checks in v1 |
| Shade imagery is from April 2025; October looks shadier than May | Demo in May mode; show the imagery date                                 |
| E-rickshaw fares are guesses                                     | Only in drawn zones, labelled estimates                                 |
| "Shade apps already exist"                                       | Lead with India, anywhere, transit + waiting, and the portal            |
| AR compass and GPS errors                                        | Calibration tap, snap to route, 2D arrow backup                         |

---

## 10. Privacy and safety

- **No accounts.** The device id is stored only as a hash.
- **Locations rounded:** logs are rounded to ~50 m and kept 30 days. Live trips are kept 30 minutes.
- **Never say a route is "safe".** Show heat alerts; give no medical advice.
- **Keys** stay in AWS Secrets Manager. **Rotate the Google key that was shared in chat.**

---

## 11. Timeline (deadline Sun 11 Oct, 23:59 IST)

All P0 and P1 features stay in. The full per-person schedule is in the team handbook PDF.

| When                       | Goal                                                                                                                          |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Thu 8 Oct** (from 16:30) | Repos, stubs, fakes, CI, AWS set up. AR test page. Sarvam client                                                              |
| **Fri 9 Oct**              | Shade worker + MUJ preload (reproduces 11.3 / 7.4). Real plan, best time, shade map. Agent on fakes. AR view on sample data   |
| **Sat 10 Oct**             | App + portal screens, portal endpoints, voice. AR on real routes. Jaipur metro areas preloaded overnight. Everything deployed |
| **Sun 11 Oct**             | Fixes until **14:00 feature freeze**; demo run-through and video; **submit by 21:00** (3 h buffer)                            |

**Daily checkpoints** (15-minute calls at 09:30 and 22:00). If a checkpoint is missed, use the fallback in the handbook. These fallbacks keep the demo working; nothing is dropped up front.

---

## 12. Open questions

- **Hackathon details:** name and judging criteria are unknown; add them here. Deadline: Sun 11 Oct, 23:59 IST.
- **Teammate names:** unknown (Person 2 = AI and voice, Person 3 = the student app and AR).

---

## 13. Facts we checked and corrected

| Claim                                | Verified value                              |
| ------------------------------------ | ------------------------------------------- |
| "Leaving at 5 PM gives 5 min of sun" | **7.4 min** (CSV)                           |
| Walk length                          | ~810 m (Google). 163 points × 5 m = 815 m   |
| Worst stretch                        | 86 points in a row ≈ 430 m (423 m measured) |
| Sun "83°" at May noon                | **82.0°** on May 15 (83.2° on May 20)       |
| API Gateway "30 s" limit             | **29 s**                                    |
| Sarvam SDK name                      | **`sarvamai`**                              |

---

## 14. Sources

- **Our own data:** `route_shade.csv`, `score_walk.py`, `google_api_test_v2.py`, pvlib at MUJ, PostGIS tests of `0001_init.sql`.
- **Google:**
  - [Maps pricing, India](https://developers.google.com/maps/billing-and-pricing/pricing-india)
  - [Solar coverage](https://developers.google.com/maps/documentation/solar/coverage)
  - [Solar usage limits](https://developers.google.com/maps/documentation/solar/usage-and-billing)
  - [Routes transitFare](https://developers.google.com/maps/documentation/routes/reference/rest/v2/RouteTravelAdvisory)
- **AWS:** [HTTP API timeout 29 s](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_apigatewayv2_integrations.HttpUrlIntegrationProps.html)
- **Sarvam:**
  - [STT limits](https://docs.sarvam.ai/api/speech-to-text/faq)
  - [STT modes](https://docs.sarvam.ai/api/api-guides-tutorials/speech-to-text/overview)
  - [TTS](https://skills.sh/sarvamai/skills/text-to-speech)
- **Weather:** [Open-Meteo history](https://open-meteo.com/en/docs/historical-weather-api), [IMD Climate of Jaipur (May mean max 40.5 °C)](https://mausam.imd.gov.in/jaipur/docs/climate.pdf)
- **Competitors:**
  - [Cool Walks](https://www.ecowatch.com/cool-walks-app-barcelona-2653527112.html)
  - [HeiGIT](https://heigit.org/?p=42664)
  - [inShade](https://apps.apple.com/app/id6779049186)
  - [ASU Cool Routes](https://news.asu.edu/20260610-environment-and-sustainability-new-cool-routes-app-maps-shadiest-routes-your-walk)
  - [Georgia Tech Cool Routes](https://news.research.gatech.edu/2026/07/09/hot-enough-ya-georgia-tech-has-app-and-its-more-useful-you-might-think)
- **Pilot site:** [About MUJ](https://jaipur.manipal.edu/about-muj.php)
