import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { api } from "../api/client";
import useShadeJob from "../api/useShadeJob";
import { planWalk, walkPointsAt } from "../api/walk";
import { bboxAround, sunnyShare, walkPieces } from "../geo";
import { atHour, dayLabel, errorMessage, fmt, hourLabel, hourOf, istIso, now } from "../format";
import { bestTimeRequest, MUJ_MAIN_GATE, recall } from "../session";
import MapView from "../components/MapView";
import TopBar from "../components/TopBar";
import Sheet from "../components/Sheet";

const FIRST_HOUR = 7;
const LAST_HOUR = 19;
const MAP_ZOOM = 15.6;
const SETTLE_MS = 250; // wait for the slider to stop before asking the API
const LEGEND = [
  { color: "bg-[#F5B47E]", text: "Sun" },
  { color: "bg-[#86B4F4]", text: "Shade" },
  { color: "bg-[#CFC6BD]", text: "No data" },
];

// Shade map (screens 18 and 19): the streets around a point, coloured by sun for the hour on the slider.
// When a walk is being looked at, it is drawn too, with its minutes in sun at that hour.
export default function ShadeMap() {
  const navigate = useNavigate();
  const nowIso = istIso(now());
  const [walk] = useState(() => recall("walk"));
  const [center, setCenter] = useState(() => {
    const origin = recall("search")?.origin;
    if (!walk) return origin || MUJ_MAIN_GATE;
    return { lat: (walk.from.lat + walk.to.lat) / 2, lng: (walk.from.lng + walk.to.lng) / 2, name: walk.from.name };
  });
  const [view] = useState(center);
  const [hour, setHour] = useState(Math.min(Math.max(hourOf(nowIso), FIRST_HOUR), LAST_HOUR));
  const [streets, setStreets] = useState(null);
  const [walked, setWalked] = useState(null);
  const [base, setBase] = useState(null);
  const [walkSlots, setWalkSlots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [sheetHeight, setSheetHeight] = useState(0);
  const walks = useRef({});
  useShadeJob(streets?.shade, () => setAttempt(attempt + 1));

  // /shade/segments again when the hour changes or the map stops moving (it takes at most 1 km²)
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    const timer = setTimeout(() => {
      api
        .get("/shade/segments", { params: { bbox: bboxAround(center), month: Number(nowIso.slice(5, 7)), hour } })
        .then((res) => current && setStreets(res.data))
        .catch((err) => current && setError(errorMessage(err)))
        .finally(() => current && setLoading(false));
    }, SETTLE_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [hour, center.lat, center.lng, attempt]);

  // The walk is planned once; each hour then reads the sun along it for that time (waypoints ?at=),
  // and its minutes in sun per hour come from /routes/best-time
  useEffect(() => {
    if (!walk) return;
    planWalk(walk, walk.at)
      .then((planned) => planned.option && setBase(planned))
      .catch(() => setBase(null));
    api
      .post("/routes/best-time", bestTimeRequest(walk.from, walk.to, walk.at, FIRST_HOUR, LAST_HOUR))
      .then((res) => setWalkSlots(res.data.slots))
      .catch(() => setWalkSlots([]));
  }, []);

  useEffect(() => {
    if (!base) return;
    if (walks.current[hour]) return setWalked(walks.current[hour]);
    let current = true;
    const timer = setTimeout(() => {
      walkPointsAt(base, atHour(walk.at, hour))
        .then((points) => {
          walks.current[hour] = { lines: walkPieces(points) };
          if (current) setWalked(walks.current[hour]);
        })
        .catch(() => current && setWalked(null));
    }, SETTLE_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [base, hour]);

  const share = streets ? sunnyShare(streets.features) : null;
  const preparing = streets?.shade.status === "PREPARING";
  const walkSlot = walkSlots.find((slot) => hourOf(slot.departAt) === hour);
  const walkSun = walkSlot ? walkSlot.sunMinutes : undefined;

  return (
    <main>
      <MapView
        camera={{ center: [view.lng, view.lat], zoom: MAP_ZOOM }}
        padding={{ top: 96, bottom: sheetHeight + 44, left: 0, right: 0 }}
        streets={streets}
        lines={walked?.lines || null}
        start={walk && [walk.from.lng, walk.from.lat]}
        end={walk && [walk.to.lng, walk.to.lat]}
        you={null}
        creditBottom={sheetHeight + 6}
        onMoved={(moved) => setCenter({ lat: moved.lat, lng: moved.lng, name: null })}
      />
      <TopBar title="Shade map" subtitle={`Around ${center.name || "this spot"} · ${dayLabel(nowIso).slice(4)}`} onBack={() => navigate(-1)} />

      <Sheet label="Shade at this hour" className="px-5 pt-1.5 pb-[calc(18px+env(safe-area-inset-bottom))]" onResize={setSheetHeight}>
        <div className="mt-2 flex min-h-11 items-baseline gap-2.5">
          {share !== null && <b className="wide text-[44px] leading-none font-[760]">{`${share}%`}</b>}
          <span className="text-[16px] text-muted">
            {error
              ? "Can't load the shade map. Check your connection."
              : share !== null
                ? "of streets here in sun"
                : loading
                  ? `Loading the shade for ${hourLabel(hour)}…`
                  : preparing
                    ? "Preparing shade data for this area. It shows here by itself."
                    : "No shade data for the streets here. Move the map to another area."}
          </span>
        </div>
        {error && (
          <button type="button" onClick={() => setAttempt(attempt + 1)} className="min-h-11 font-[650] text-shade-text">
            Try again
          </button>
        )}
        <p className="mt-1.5 text-[16px] font-semibold">
          {walk && walkSun !== undefined ? `At ${hourLabel(hour)} · ${walk.title.replace("Walk", "your walk")}: ${walkSun === null ? "minutes in sun unknown" : `${fmt(walkSun)} min in sun`}` : `At ${hourLabel(hour)}`}
        </p>
        <input
          type="range"
          aria-label="Hour of day"
          aria-valuetext={hourLabel(hour)}
          min={FIRST_HOUR}
          max={LAST_HOUR}
          step={1}
          value={hour}
          onChange={(event) => setHour(Number(event.target.value))}
          className="mt-3 h-8 w-full accent-ink"
        />
        <div className="flex justify-between text-[13px] text-muted">
          {[7, 10, 13, 16, 19].map((mark) => (
            <span key={mark}>{hourLabel(mark)}</span>
          ))}
        </div>
        <div className="mt-2.5 flex gap-3.5 text-[14px] font-semibold">
          {LEGEND.map((item) => (
            <span key={item.text}>
              <i className={`mr-1.5 inline-block h-[5px] w-3.5 rounded-[3px] align-middle ${item.color}`} />
              {item.text}
            </span>
          ))}
        </div>
      </Sheet>
    </main>
  );
}
