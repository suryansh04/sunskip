import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { CaretRight, NavigationArrow, PersonSimpleWalk, Taxi, ThermometerHot, Tree, WifiSlash } from "@phosphor-icons/react";
import { api } from "../api/client";
import { planWalk, walkPointsAt } from "../api/walk";
import { bboxAround, boundsOf, sunBit, walkPieces } from "../geo";
import { atHour, duration, errorMessage, hourLabel, hourOf, istIso, labelsText, now, shortTime } from "../format";
import { bestTimeRequest, recall } from "../session";
import MapView from "../components/MapView";
import TopBar from "../components/TopBar";
import Sheet from "../components/Sheet";
import Button from "../components/Button";
import SunNumber from "../components/SunNumber";
import SunStrip from "../components/SunStrip";
import HourBars from "../components/HourBars";
import SwapRow from "../components/SwapRow";
import StateMessage from "../components/StateMessage";

const LAST_HOUR = 19; // the last start hour with daylight
const MAX_BARS = 7;
const WALK_MAX_ZOOM = 16.6;
const STREET_OPACITY = 0.55;
const RECOLOUR_STEP_MS = 14;
const DRAW_DELAY_MS = 250;
const DRAW_STEP_MS = 16;

// One walk of the trip (screens 12 and 13): its minutes in direct sun, the sun and shade along it,
// and how that changes when you leave later.
export default function WalkDetail() {
  const navigate = useNavigate();
  const [walk] = useState(() => recall("walk"));
  const [hour, setHour] = useState(walk ? hourOf(walk.at) : 0);
  const [planned, setPlanned] = useState(null);
  const [points, setPoints] = useState(null);
  const [slots, setSlots] = useState([]);
  const [streets, setStreets] = useState(null);
  const [lines, setLines] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [starting, setStarting] = useState(false);
  const [sheetHeight, setSheetHeight] = useState(0);
  const pointsByHour = useRef({});
  const startHour = walk ? hourOf(walk.at) : 0;
  const departAt = walk && (hour === startHour ? walk.at : atHour(walk.at, hour));

  useEffect(() => {
    if (!walk) navigate("/", { replace: true });
  }, []);

  // The walk is planned once, at its start time
  useEffect(() => {
    if (!walk) return;
    setLoading(true);
    setError("");
    pointsByHour.current = {};
    planWalk(walk, walk.at)
      .then((result) => {
        pointsByHour.current[startHour] = result.points;
        setPlanned(result);
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, [attempt]);

  // Another hour reads the sun along the same walk for that time. Hours already loaded are kept,
  // so tapping back and forth is instant. A trip is kept 30 min; after that (404) the walk is planned again.
  useEffect(() => {
    if (!planned?.option) return;
    if (pointsByHour.current[hour]) {
      setLoading(false); // an hour still loading may have been left for this one
      return setPoints(pointsByHour.current[hour]);
    }
    let current = true;
    setLoading(true);
    walkPointsAt(planned, departAt)
      .then((loaded) => {
        pointsByHour.current[hour] = loaded;
        if (current) setPoints(loaded);
      })
      .catch((err) => {
        if (!current) return;
        if (err.response?.status === 404) return setAttempt((tries) => tries + 1);
        setError(errorMessage(err));
      })
      .finally(() => current && setLoading(false));
    return () => {
      current = false;
    };
  }, [planned, hour]);

  useEffect(() => {
    if (!walk || startHour >= LAST_HOUR) return;
    api
      .post("/routes/best-time", bestTimeRequest(walk.from, walk.to, walk.at, startHour, LAST_HOUR))
      .then((res) => setSlots(res.data.slots.slice(0, MAX_BARS)))
      .catch(() => setSlots([]));
  }, []);

  useEffect(() => {
    if (!walk) return;
    const middle = { lat: (walk.from.lat + walk.to.lat) / 2, lng: (walk.from.lng + walk.to.lng) / 2 };
    let current = true; // the streets of an hour no longer picked are dropped
    api
      .get("/shade/segments", { params: { bbox: bboxAround(middle), month: Number(walk.at.slice(5, 7)), hour } })
      .then((res) => current && setStreets(res.data))
      .catch(() => current && setStreets(null));
    return () => {
      current = false;
    };
  }, [hour]);

  // First the line draws itself from start to stop; after that a new hour recolours it piece by piece
  useEffect(() => {
    if (!points) return;
    const pieces = walkPieces(points);
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (still || (lines && lines.length !== pieces.length)) return setLines(pieces);
    const timers = pieces.map((piece, i) =>
      lines
        ? setTimeout(() => setLines((shown) => shown.map((old, j) => (j === i ? piece : old))), i * RECOLOUR_STEP_MS)
        : setTimeout(() => setLines(pieces.slice(0, i + 1)), DRAW_DELAY_MS + i * DRAW_STEP_MS),
    );
    return () => timers.forEach(clearTimeout);
  }, [points]);

  function startWalking() {
    // Leaving at another hour: the directions show the sun for that time
    const later = hour === startHour ? "" : `?at=${encodeURIComponent(departAt)}`;
    const startTrip = () => navigate(`/trip/${planned.tripId}/${planned.option.optionId}${later}`);
    setStarting(true);
    // An expired trip (404) is planned again; any other failed log doesn't stop the walk
    api
      .post(`/routes/${planned.tripId}/choice`, { optionId: planned.option.optionId })
      .then(startTrip)
      .catch((err) => {
        if (err.response?.status !== 404) return startTrip();
        setStarting(false);
        setAttempt(attempt + 1);
      });
  }

  if (!walk) return null;

  const option = planned?.option;
  const atStart = hour === startHour;
  // Other hours take the walk's sun minutes from the bars (/routes/best-time); unknown if the bars don't have it
  const sunMinutes = atStart ? (option?.exposure.sunMinutes ?? null) : (slots.find((slot) => hourOf(slot.departAt) === hour)?.sunMinutes ?? null);
  const feels = planned?.conditions.feelsLikeC;
  const isNow = hour === hourOf(istIso(now()));
  const bits = (points || []).map((point) => sunBit(point.inSun));
  const coords = (points || []).map((point) => [point.location.lng, point.location.lat]);
  const comparable = slots.length > 1 && slots.every((slot) => slot.sunMinutes !== null);

  return (
    <main>
      <MapView
        camera={coords.length > 1 ? { bounds: boundsOf(coords), maxZoom: WALK_MAX_ZOOM } : { center: [walk.from.lng, walk.from.lat], zoom: 15.6 }}
        padding={{ top: 96, bottom: sheetHeight + 44, left: 40, right: 40 }}
        streets={streets}
        streetOpacity={STREET_OPACITY}
        lines={lines}
        start={[walk.from.lng, walk.from.lat]}
        end={[walk.to.lng, walk.to.lat]}
        you={null}
        creditBottom={sheetHeight + 6}
        onMoved={null}
      />
      <TopBar title={walk.title} subtitle={`${walk.partOfTrip ? "First part of your trip" : "Your walk"}${option ? ` · ${option.exposure.walkMeters} m` : ""}`} onBack={() => navigate(-1)} />

      <Sheet label="Walk detail" className="top-[38%] overflow-y-auto overscroll-contain" onResize={setSheetHeight}>
        {!planned && loading && (
          <div className="mx-5 mt-4 grid gap-3" aria-label="Loading the walk">
            <p className="text-[15px] text-muted">Checking the sun along this walk…</p>
            <i className="shimmer block h-16 w-3/5 rounded-md" />
            <i className="shimmer block h-3.5 rounded-md" />
            <i className="shimmer block h-24 rounded-md" />
          </div>
        )}
        {error && (
          <StateMessage icon={<WifiSlash size={30} weight="bold" />} title="Can't load this walk" text={`${error}. Check your internet connection and try again.`}>
            <Button className="mt-1" onClick={() => setAttempt(attempt + 1)}>
              Try again
            </Button>
          </StateMessage>
        )}
        {planned && !option && !error && (
          <StateMessage icon={<PersonSimpleWalk size={30} weight="bold" />} title="No walk to show" text="SunSkip couldn't plan this part on foot. Go back and pick another route." />
        )}

        {option && !error && (
          <>
            <section className={`px-5 pt-2.5 ${lines ? "" : "animate-land"}`}>
              <div className="flex flex-wrap items-center gap-1.5 text-[15px] text-muted">
                {isNow ? `Walking now, ${shortTime(departAt)}` : `Walking at ${hourLabel(hour)}`}
                {planned.conditions.heatAlert && (
                  <span className="inline-flex items-center gap-1 font-[650] text-alert">
                    <ThermometerHot size={18} weight="bold" />
                    {`${Math.round(feels)}°C heat alert`}
                  </span>
                )}
                {!planned.conditions.heatAlert && feels != null && <span>{`· feels like ${Math.round(feels)}°C`}</span>}
              </div>
              <div className="mt-0.5 flex items-end gap-3">
                <SunNumber value={sunMinutes} className="min-w-[2.6ch] text-[84px] leading-[.9] tracking-[-2px]" />
                <span className="pb-1.5 text-[18px] leading-[1.2] font-semibold">
                  min in
                  <br />
                  direct sun
                </span>
              </div>
              <p className="mt-2.5 text-[15px] text-muted">
                {`${option.exposure.walkMeters} m · ${duration(option.durationSeconds)} on foot`}
                {atStart && ` · ${option.exposure.shadePct === null ? "shade unknown" : `${Math.round(option.exposure.shadePct)}% in shade`}`}
              </p>
            </section>
            <div className="mx-5 mt-3.5">
              <SunStrip bits={bits} enter stepMs={RECOLOUR_STEP_MS} />
              <div className="mt-1.5 flex justify-between text-[13px] text-muted">
                <span>{walk.from.name}</span>
                <span>{walk.to.name}</span>
              </div>
            </div>

            {comparable && (
              <section className="mx-5 mt-[22px] animate-rise border-t border-line pt-[18px] [animation-delay:.5s]">
                <h2 className="text-[17px] leading-[1.3] font-[650]">Leave later, walk in less sun</h2>
                <p className="mt-0.5 text-[14px] text-muted">Minutes in direct sun for each start time. Tap one.</p>
                <HourBars slots={slots} hour={hour} onPick={setHour} />
                <button type="button" onClick={() => navigate("/best-time?for=walk")} className="mt-1 flex min-h-12 w-full items-center justify-between font-[650] text-shade-text">
                  See the whole day
                  <CaretRight size={20} weight="bold" />
                </button>
              </section>
            )}

            {atStart && (planned.erickshaw || planned.shadier) && (
              <section className="mx-5 mt-[22px] animate-rise border-t border-line pt-[18px] [animation-delay:.5s]">
                <h2 className="text-[17px] leading-[1.3] font-[650]">Or skip the sun</h2>
                {planned.erickshaw && (
                  <SwapRow
                    icon={<Taxi size={22} weight="bold" />}
                    title="E-rickshaw"
                    detail={`${duration(planned.erickshaw.durationSeconds)} · ${planned.erickshaw.fareInr === null ? "fare unknown" : `₹${planned.erickshaw.fareInr}, estimated`}`}
                    tags={labelsText(planned.erickshaw.labels)}
                    sunMinutes={planned.erickshaw.exposure.sunMinutes}
                  />
                )}
                {planned.shadier && (
                  <SwapRow
                    shade
                    icon={<Tree size={22} weight="bold" />}
                    title="Shadier path"
                    detail={`${planned.shadier.exposure.walkMeters} m · a slightly different way`}
                    sunMinutes={planned.shadier.exposure.sunMinutes}
                  />
                )}
              </section>
            )}

            <div className="sticky bottom-0 z-[2] mt-3 border-t border-line bg-white px-5 pt-3 pb-[calc(14px+env(safe-area-inset-bottom))]">
              <Button onClick={startWalking} disabled={starting || loading}>
                <NavigationArrow size={20} weight="fill" />
                {isNow ? "Start walking" : `Start walking at ${hourLabel(hour)}`}
              </Button>
            </div>
          </>
        )}
      </Sheet>
    </main>
  );
}
