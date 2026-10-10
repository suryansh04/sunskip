import { useEffect, useState } from "react";
import { useOutletContext } from "react-router";
import { ArrowsClockwise, ChartBar, WifiSlash } from "@phosphor-icons/react";
import { api } from "../api/client";
import { AREAS } from "../areas";
import { errorMessage, inr, pct } from "../format";
import { fitTo, flyTo, setSource, showLayers } from "../map";
import PanelHead from "../components/PanelHead";
import SkeletonRows from "../components/SkeletonRows";
import StateMessage from "../components/StateMessage";

const RANGES = [7, 30, 90];
const INDIA = { south: 6, north: 37, west: 68, east: 98 };
const NEAR_DEG = 0.02; // about 2 km: close enough to call it "near" an area
const CLUSTER_DEG = 0.2; // the map opens on the start points within about 20 km of the busiest one
const ORIGIN_ZOOM = 15;
const FIT_ZOOM = 14;
const DAY_MS = 86400000;

// The API counts days in India time; before 5:30 AM IST the UTC date is still yesterday
function isoDay(date) {
  return date.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

function placeOf(location) {
  if (location.lat < INDIA.south || location.lat > INDIA.north || location.lng < INDIA.west || location.lng > INDIA.east) return "Outside India";
  const near = AREAS.find((area) => Math.abs(area.center[1] - location.lat) < NEAR_DEG && Math.abs(area.center[0] - location.lng) < NEAR_DEG);
  return near ? `Near ${near.name}` : "Elsewhere in India";
}

function Stat({ value, label }) {
  return (
    <div className="flex flex-col gap-1 px-6.5 py-4.5 even:border-l even:border-line [&:nth-child(n+3)]:border-t [&:nth-child(n+3)]:border-line">
      <span className="num text-[56px] leading-[0.9]">{value}</span>
      <span className="text-[13px] text-muted">{label}</span>
    </div>
  );
}

// Usage (P6): how the student app is used, and where trips start (rounded to about 50 m)
export default function Stats() {
  const { map } = useOutletContext<any>();
  const [days, setDays] = useState(30);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    const today = new Date();
    api
      .get("/portal/stats", { params: { from: isoDay(new Date(today.getTime() - days * DAY_MS)), to: isoDay(today) } })
      .then((res) => current && setStats(res.data))
      .catch((err) => current && setError(errorMessage(err)))
      .finally(() => current && setLoading(false));
    return () => {
      current = false;
    };
  }, [days, attempt]);

  const origins = stats?.topOrigins || [];
  const most = origins[0]?.count || 1;

  // Circles where trips start, sized by count. The map opens on the busiest place; a far-off start
  // (another city) would zoom it out until the circles can't be seen. The list flies to any of them.
  useEffect(() => {
    if (!map) return;
    showLayers(map, ["origins"]);
    setSource(
      map,
      "origins",
      origins.map((origin) => ({ type: "Feature", properties: { share: origin.count / most }, geometry: { type: "Point", coordinates: [origin.location.lng, origin.location.lat] } })),
    );
    const busiest = origins[0]?.location;
    const around = origins.filter((origin) => busiest && Math.abs(origin.location.lat - busiest.lat) < CLUSTER_DEG && Math.abs(origin.location.lng - busiest.lng) < CLUSTER_DEG);
    fitTo(
      map,
      around.map((origin) => [origin.location.lng, origin.location.lat]),
      FIT_ZOOM,
      { pitch: 0, bearing: 0 },
    );
    return () => setSource(map, "origins", []);
  }, [map, stats]);

  return (
    <aside className="flex min-h-0 flex-col border-l-2 border-ink bg-white">
      <PanelHead title="Usage">Trips planned in the SunSkip app, all areas. Start points are rounded to about 50 m; people are never identified.</PanelHead>
      <div className="flex border-b border-line">
        {RANGES.map((range) => (
          <button
            key={range}
            type="button"
            aria-pressed={days === range}
            onClick={() => setDays(range)}
            className={`flex min-h-[62px] flex-1 flex-col justify-center border-r border-line px-4 py-2.5 text-left text-[12.5px] last:border-r-0 ${days === range ? "bg-ink text-bartext" : "text-muted hover:bg-hover"}`}
          >
            Last
            <b className={`text-[15px] ${days === range ? "text-white" : "text-ink"}`}>{range} days</b>
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {error && (
          <StateMessage icon={<WifiSlash size={40} weight="bold" />} title="Can't reach SunSkip" text={`${error}. Check your connection and try again.`}>
            <button type="button" onClick={() => setAttempt((n) => n + 1)} className="flex min-h-[46px] items-center gap-2 bg-ink px-5 font-bold text-white">
              <ArrowsClockwise size={18} weight="bold" />
              Try again
            </button>
          </StateMessage>
        )}
        {loading && !stats && !error && <SkeletonRows />}
        {stats && !error && stats.requests === 0 && (
          <StateMessage icon={<ChartBar size={40} weight="bold" />} title="No trips in these dates" text="Trips show here once people plan them in the app. Try a longer range." />
        )}
        {stats && !error && stats.requests > 0 && (
          <div className="animate-enter">
            <div className="grid grid-cols-2 border-b-2 border-ink">
              <Stat value={inr(stats.requests)} label="trips planned" />
              <Stat value={pct(stats.okRequests / stats.requests)} label={`got routes (${inr(stats.okRequests)})`} />
              <Stat value={pct(stats.choiceRate)} label={`picked a route ("I'm taking this one")`} />
              <Stat value={stats.avgSunMinutesPerTrip ?? "unknown"} label="average minutes walking in sun per trip" />
            </div>
            <div className="flex items-baseline justify-between border-b border-line px-6.5 py-2.5">
              <b className="cond text-[17px]">Where trips start</b>
              <span className="text-[12.5px] font-semibold text-muted">Trips</span>
            </div>
            {origins.map((origin, i) => (
              <button
                key={`${origin.location.lat},${origin.location.lng}`}
                type="button"
                onClick={() => map && flyTo(map, [origin.location.lng, origin.location.lat], ORIGIN_ZOOM)}
                className="grid w-full grid-cols-[40px_1fr_150px] items-center gap-2.5 border-b border-line px-6.5 py-2.5 text-left hover:bg-hover"
              >
                <span className="num text-[23px] leading-none">{i + 1}</span>
                <span>
                  <b className="block text-[14.5px] font-[650] tabular-nums">
                    {origin.location.lat.toFixed(4)}, {origin.location.lng.toFixed(4)}
                  </b>
                  <small className="text-[12.5px] text-muted">{placeOf(origin.location)}</small>
                </span>
                <span className="flex items-center justify-end gap-2.5">
                  <i className="block h-2.5 bg-ink" style={{ width: `${(80 * origin.count) / most}px` }} />
                  <span className="num min-w-[38px] text-right text-[22px]">{inr(origin.count)}</span>
                </span>
              </button>
            ))}
            <p className="px-6.5 pt-4 pb-6 text-[13px] leading-normal text-muted">Trips from outside India are planned but get no shade data.</p>
          </div>
        )}
      </div>
      <div className="absolute top-5 left-5 z-[3] flex border-2 border-ink bg-white px-3 py-2 text-[12px] font-bold">
        <span className="flex items-center gap-1.5">
          <i className="size-3.5 rounded-full bg-ink" />
          Trips start here · size = number of trips
        </span>
      </div>
    </aside>
  );
}
