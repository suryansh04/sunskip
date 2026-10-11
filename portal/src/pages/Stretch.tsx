import { useEffect, useState } from "react";
import { useLocation, useNavigate, useOutletContext, useParams } from "react-router";
import { ArrowLeft, ArrowsClockwise, Cube, MagnifyingGlass, Printer, WifiSlash } from "@phosphor-icons/react";
import { api } from "../api/client";
import { bandOf } from "../bands";
import { errorMessage, inr, pct } from "../format";
import { flatCoords } from "../map";
import StateMessage from "../components/StateMessage";
import SunGrid from "../components/SunGrid";
import StretchDrawing from "../components/StretchDrawing";

const RANKED = { month: 5, hours: "10-16", limit: 50 };
const MAY = 4;
const HOT_SHARE = 0.9;
const MARGIN_M = 150; // paths drawn around the stretch
const MAX_BOX_M = 950; // /shade/segments takes at most 1 km²
const METERS_PER_DEG = 111320;

// A box around the stretch for /shade/segments, never bigger than the endpoint allows
function boxAround(geometry) {
  const points = flatCoords(geometry);
  const lngs = points.map((point) => point[0]);
  const lats = points.map((point) => point[1]);
  const midLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const kx = METERS_PER_DEG * Math.cos((midLat * Math.PI) / 180);
  const halfX = Math.min(((Math.max(...lngs) - Math.min(...lngs)) * kx) / 2 + MARGIN_M, MAX_BOX_M / 2) / kx;
  const halfY = Math.min(((Math.max(...lats) - Math.min(...lats)) * METERS_PER_DEG) / 2 + MARGIN_M, MAX_BOX_M / 2) / METERS_PER_DEG;
  return [midLng - halfX, midLat - halfY, midLng + halfX, midLat + halfY].map((n) => n.toFixed(6)).join(",");
}

function Kpi({ value, label, color = undefined }) {
  return (
    <div className="flex flex-col gap-1 px-4.5 py-4 not-first:border-l not-first:border-line">
      <span className="num text-[58px] leading-[0.9]" style={{ color }}>
        {value}
      </span>
      <span className="text-[13px] text-muted">{label}</span>
    </div>
  );
}

function WalkerRow({ title, text, value, total = false }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 py-3 ${total ? "border-b-2 border-ink" : "border-b border-line"}`}>
      <span className="text-[13.5px] text-muted">
        <b className="block text-[15px] text-ink">{title}</b>
        {text}
      </span>
      <span className={`num ${total ? "text-[44px]" : "text-[30px]"}`}>{value}</span>
    </div>
  );
}

// Stretch evidence (P4): everything an official needs to argue for this one stretch, and it prints on A4
export default function Stretch() {
  const { area } = useOutletContext<any>();
  const { stretchId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from || "pain";
  const [evidence, setEvidence] = useState(null);
  const [ranking, setRanking] = useState(null);
  const [paths, setPaths] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.all([api.get(`/portal/stretches/${stretchId}`), api.get("/portal/heat-pain", { params: { bbox: area.bbox, ...RANKED } })])
      .then(([stretch, pain]) => {
        setEvidence(stretch.data);
        setRanking(pain.data.features);
      })
      .catch((err) => setError({ missing: err.response?.status === 404, message: errorMessage(err) }))
      .finally(() => setLoading(false));
  }, [stretchId, area.key, attempt]);

  const rankIndex = (ranking || []).findIndex((feature) => feature.properties.stretchId === stretchId);
  const ranked = rankIndex >= 0 ? ranking[rankIndex] : null;

  useEffect(() => {
    if (!ranked) return;
    api
      .get("/shade/segments", { params: { bbox: boxAround(ranked.geometry), month: RANKED.month, hour: 13 } })
      .then((res) => setPaths(res.data))
      .catch(() => setPaths(null));
  }, [ranked?.properties.stretchId]);

  const backLabel = from === "recs" ? "Trees + shelters" : "Heat pain";
  const back = () => navigate(from === "recs" ? "/recommendations" : "/");

  if (loading || error) {
    return (
      <section className="col-span-2 overflow-auto">
        {loading && <p className="p-10 text-muted">Loading the evidence for this stretch…</p>}
        {error?.missing && (
          <StateMessage icon={<MagnifyingGlass size={40} weight="bold" />} title="Stretch not found" text="This stretch isn't in SunSkip any more. The paths may have been fetched again.">
            <button type="button" onClick={back} className="flex min-h-[46px] items-center gap-2 bg-ink px-5 font-bold text-white">
              <ArrowLeft size={18} weight="bold" />
              Back to {backLabel}
            </button>
          </StateMessage>
        )}
        {error && !error.missing && (
          <StateMessage icon={<WifiSlash size={40} weight="bold" />} title="Can't reach SunSkip" text={`${error.message}. Check your connection and try again.`}>
            <button type="button" onClick={() => setAttempt((n) => n + 1)} className="flex min-h-[46px] items-center gap-2 bg-ink px-5 font-bold text-white">
              <ArrowsClockwise size={18} weight="bold" />
              Try again
            </button>
          </StateMessage>
        )}
      </section>
    );
  }

  const pain = ranked?.properties;
  const peakHours = evidence.sunByMonthHour[MAY].filter((sun) => sun !== null && sun >= HOT_SHARE).length;
  const appTripsPerDay = evidence.walkers.appTrips30d === null ? null : Math.round(evidence.walkers.appTrips30d / 30);
  const printedOn = new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

  return (
    <section className="col-span-2 overflow-auto print:overflow-visible">
      <div className="mx-auto max-w-[1120px] animate-enter px-10 pt-5.5 pb-14 print:max-w-none print:p-0">
        <div className="hidden justify-between pb-2 text-[11px] text-muted print:flex">
          <span>SunSkip · Stretch evidence</span>
          <span>
            {area.place} · printed {printedOn}
          </span>
        </div>
        <div className="flex items-center gap-2.5 pb-4.5 print:hidden">
          <button type="button" onClick={back} className="flex min-h-10 items-center gap-2 pr-3 font-bold hover:underline">
            <ArrowLeft size={18} weight="bold" />
            {backLabel}
          </button>
          <span className="flex-1" />
          <button
            type="button"
            onClick={() => navigate("/simulate", { state: { stretchId } })}
            className="flex min-h-[46px] items-center gap-2 bg-white px-5 font-bold shadow-[inset_0_0_0_2px_var(--color-ink)] hover:bg-hover"
          >
            <Cube size={18} weight="bold" />
            Try trees in 3D
          </button>
          <button type="button" onClick={() => window.print()} className="flex min-h-[46px] items-center gap-2 bg-ink px-5 font-bold text-white hover:bg-[#2E2723]">
            <Printer size={18} weight="bold" />
            Print or save as PDF
          </button>
        </div>

        <div className="border-t-2 border-ink pt-4">
          <h1 className="cond text-[84px] leading-[0.86] print:text-[60px]">{evidence.name || "Unnamed path"}</h1>
          <p className="mt-2.5 text-muted">
            {area.place} · {inr(evidence.lengthM)} m · {evidence.segmentIds.length} path pieces · {evidence.stretchId}
          </p>
        </div>

        <div className="mt-5.5 grid grid-cols-4 border-y-2 border-ink break-inside-avoid">
          <Kpi value={inr(evidence.walkers.perDay)} label="people walk it a day (estimate)" />
          <Kpi value={pain ? pct(pain.sunShare) : "unknown"} label="in direct sun, May 10 AM – 4 PM" />
          <Kpi value={peakHours} label="hours a day 90%+ in sun in May" />
          <Kpi
            value={pain?.painScore ?? "–"}
            color={bandOf(pain?.painScore).text}
            label={ranked ? `pain · rank ${rankIndex + 1} in ${area.name}` : `pain · not in the top ${RANKED.limit} in ${area.name}`}
          />
        </div>

        <div className="mt-7.5 break-inside-avoid">
          <h2 className="cond border-t-2 border-ink pt-3 text-[28px]">Sun on this stretch, every month and hour</h2>
          <p className="mt-1 text-[13.5px] text-muted">Share of the path in direct sun, from Google's shade data. The outlined hours are the ones the ranking uses.</p>
          <SunGrid sunByMonthHour={evidence.sunByMonthHour} />
        </div>

        <div className="grid grid-cols-[1fr_1.2fr] gap-9">
          <div className="mt-7.5 break-inside-avoid">
            <h2 className="cond border-t-2 border-ink pt-3 text-[28px]">Who walks here</h2>
            <p className="mt-1 text-[13.5px] text-muted">Estimates; the ranking uses the total.</p>
            <div className="mt-2">
              <WalkerRow title="From nearby places" text="Colleges, stops and shops within 400 m, weighted by distance" value={inr(evidence.walkers.poiEstimate)} />
              <WalkerRow title="From SunSkip trips" text="Trips over the last 30 days, per day" value={inr(appTripsPerDay)} />
              <WalkerRow title="People a day" text="Used for the pain score" value={inr(evidence.walkers.perDay)} total />
            </div>
          </div>
          <div className="mt-7.5 break-inside-avoid">
            <h2 className="cond border-t-2 border-ink pt-3 text-[28px]">Where it is</h2>
            <p className="mt-1 text-[13.5px] text-muted">The stretch in orange; nearby paths in grey.</p>
            {paths ? <StretchDrawing stretchId={stretchId} paths={paths} /> : <p className="mt-3.5 bg-hover p-6 text-[13.5px] text-muted">The drawing shows once the paths around it load.</p>}
          </div>
        </div>

        <p className="mt-7.5 max-w-[80ch] border-t border-line pt-3 text-[12.5px] leading-relaxed text-muted">
          Shade: Google Solar API data layers, sampled every 5 m along OpenStreetMap paths. People a day: SunSkip estimate from OpenStreetMap places and app trips. Sun position: pvlib, day 15 of each
          month. Paths © OpenStreetMap contributors.
        </p>
      </div>
    </section>
  );
}
