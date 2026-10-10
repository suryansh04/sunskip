import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { CaretDown, ClockCounterClockwise, Crosshair, MagnifyingGlass, MapTrifold, Microphone, ThermometerHot } from "@phosphor-icons/react";
import { api } from "../api/client";
import useShadeJob from "../api/useShadeJob";
import { isLive } from "../api/live";
import { bboxAround, boxAround, sunnyShare } from "../geo";
import { dayLabel, errorMessage, fromLine, hourLabel, hourOf, istIso, now, timeOf } from "../format";
import { addRecentPlace, MUJ_MAIN_GATE, NEW_SEARCH, recall, recentPlaces, remember } from "../session";
import MapView from "../components/MapView";
import Sheet from "../components/Sheet";
import Button from "../components/Button";
import RoundButton from "../components/RoundButton";
import Segmented from "../components/Segmented";
import HeatSheet from "../components/HeatSheet";
import TimeSheet from "../components/TimeSheet";
import ChatPanel from "../features/agent/ChatPanel";

const USE_MOCKS = import.meta.env.VITE_USE_MOCKS === "true";
const HOME_MAX_ZOOM = 15.6;
const NEAR_YOU_M = 300; // how far around you the map shows at first
const FIND_DOTS_MS = 400;
const DAY_MS = 24 * 60 * 60 * 1000;

function searchedWhen(searchedAt) {
  const days = Math.round((Date.parse(dayStart(istIso(now()))) - Date.parse(dayStart(searchedAt))) / DAY_MS);
  const day = days === 0 ? "Today" : days === 1 ? "Yesterday" : dayLabel(searchedAt);
  return `${day}, ${timeOf(searchedAt)}`;
}

function dayStart(iso) {
  return iso.slice(0, 10) + "T00:00:00+05:30";
}

export default function Home() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const nowIso = istIso(now());
  const [search, setSearch] = useState(() => recall("search") || NEW_SEARCH);
  const [conditions, setConditions] = useState(undefined); // undefined while loading, null when it failed
  const [streets, setStreets] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [finding, setFinding] = useState(false);
  const [sheetHeight, setSheetHeight] = useState(420);
  const [heatOpen, setHeatOpen] = useState(false);
  const [timeMode, setTimeMode] = useState("");
  const [shadeAttempt, setShadeAttempt] = useState(0);
  const [askLive, setAskLive] = useState(false);
  // Streets still being prepared show up by themselves when their shade job is done
  useShadeJob(streets?.shade, () => setShadeAttempt(shadeAttempt + 1));
  const { origin, destination } = search;

  function update(change) {
    setSearch((current) => {
      const next = { ...current, ...change };
      remember("search", next);
      return next;
    });
  }

  function locate() {
    if (USE_MOCKS || !navigator.geolocation) return update({ origin: { ...MUJ_MAIN_GATE, mine: USE_MOCKS } });
    navigator.geolocation.getCurrentPosition(
      (position) => update({ origin: { lat: position.coords.latitude, lng: position.coords.longitude, name: null, mine: true } }),
      () => update({ origin: { ...MUJ_MAIN_GATE, mine: false } }),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  useEffect(() => {
    if (!origin) locate();
    isLive("/agent/chat").then(setAskLive);
  }, []);

  useEffect(() => {
    if (!origin) return;
    api
      .get("/conditions", { params: { lat: origin.lat, lng: origin.lng, at: nowIso } })
      .then((res) => setConditions(res.data))
      .catch(() => setConditions(null));
  }, [origin?.lat, origin?.lng]);

  useEffect(() => {
    if (!origin) return;
    setLoading(true);
    setError("");
    api
      .get("/shade/segments", { params: { bbox: bboxAround(origin), month: Number(nowIso.slice(5, 7)), hour: hourOf(nowIso) } })
      .then((res) => setStreets(res.data))
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, [origin?.lat, origin?.lng, shadeAttempt]);

  function findRoutes(place) {
    if (!place) return navigate("/search");
    update({ destination: place });
    addRecentPlace(place, nowIso);
    setFinding(true);
    setTimeout(() => navigate("/results"), FIND_DOTS_MS);
  }

  const share = streets ? sunnyShare(streets.features) : null;
  const shadeNote = loading
    ? "Checking the shade near you…"
    : error
      ? "Can't load the shade map"
      : share === null
        ? streets.shade.status === "PREPARING"
          ? "Preparing shade data near you…"
          : "No shade data near you yet"
        : `${share}% of streets near you in sun`;
  const whenOptions = [
    { value: "now", label: "Leave now" },
    { value: "leave", label: search.when === "leave" && search.at ? `Leave ${hourLabel(hourOf(search.at))}` : "Leave at…" },
    { value: "arrive", label: search.when === "arrive" && search.at ? `Arrive ${hourLabel(hourOf(search.at))}` : "Arrive by…" },
  ];
  const recents = recentPlaces();
  const center = origin || MUJ_MAIN_GATE;

  return (
    <main>
      <MapView
        camera={{ bounds: boxAround(center, NEAR_YOU_M), maxZoom: HOME_MAX_ZOOM }}
        padding={{ top: 96, bottom: sheetHeight + 44, left: 40, right: 40 }}
        streets={streets}
        start={origin && [origin.lng, origin.lat]}
        end={null}
        you={null}
        lines={null}
        creditBottom={sheetHeight + 52}
        onMoved={null}
      />

      <div className="absolute inset-x-0 top-0 z-10 flex items-center gap-2.5 px-4 py-3.5">
        {conditions?.feelsLikeC != null ? (
          <button
            type="button"
            onClick={() => setHeatOpen(true)}
            className={`press inline-flex min-h-10 items-center gap-2 rounded-xl pr-3.5 pl-[11px] text-[15px] font-[650] shadow-[0_2px_10px_rgba(40,25,10,.14)] ${conditions.heatAlert ? "bg-alert text-white" : "bg-white text-ink"}`}
          >
            <ThermometerHot size={20} weight="bold" />
            {`Feels like ${Math.round(conditions.feelsLikeC)}°C` + (conditions.heatAlert ? " · heat alert" : "")}
            <CaretDown size={16} weight="bold" />
          </button>
        ) : (
          <span className="inline-flex min-h-10 items-center rounded-xl bg-white px-3.5 text-[15px] text-muted shadow-[0_2px_10px_rgba(40,25,10,.14)]">
            {conditions === undefined ? "Checking the heat…" : "Feels-like temperature unknown"}
          </span>
        )}
        <span className="flex-1" />
        <RoundButton label="Show my location" onClick={locate}>
          <Crosshair size={22} weight="bold" />
        </RoundButton>
      </div>

      <div
        className="absolute inset-x-4 flex items-center justify-between gap-2 rounded-[10px] bg-white/95 px-[11px] py-[7px] text-[14px] font-semibold whitespace-nowrap shadow-[0_2px_10px_rgba(40,25,10,.12)]"
        style={{ bottom: sheetHeight + 12 }}
      >
        <span className="truncate">{shadeNote}</span>
        {error && (
          <button type="button" onClick={() => setShadeAttempt(shadeAttempt + 1)} className="font-[650] text-shade-text">
            Try again
          </button>
        )}
        <span className={`gap-2.5 text-[13px] font-normal text-muted ${error ? "hidden" : "flex"}`}>
          <span>
            <i className="mr-[5px] inline-block h-[5px] w-3.5 rounded-[3px] bg-[#F5B47E] align-middle" />
            Sun
          </span>
          <span>
            <i className="mr-[5px] inline-block h-[5px] w-3.5 rounded-[3px] bg-[#86B4F4] align-middle" />
            Shade
          </span>
        </span>
      </div>

      <Sheet label="Plan a trip" className="px-4 pt-1.5 pb-[18px]" onResize={setSheetHeight}>
        <div className="mt-3 flex min-h-[58px] items-center gap-3 rounded-[14px] bg-sunken px-3.5">
          <button type="button" onClick={() => navigate("/search")} className="flex min-h-[58px] min-w-0 flex-1 items-center gap-3">
            <MagnifyingGlass size={20} weight="bold" className="flex-none text-muted" />
            <span className="min-w-0 flex-1">
              <small className="block text-[13px] leading-[1.2] text-muted">Where to?</small>
              <b className={`block truncate text-[17px] leading-[1.3] font-semibold ${destination ? "" : "text-muted"}`}>{destination ? destination.name : "Search for a place"}</b>
            </span>
          </button>
          {askLive && (
            <button type="button" aria-label="Ask by voice" onClick={() => setParams({ ask: "voice" })} className="press grid size-11 flex-none place-items-center rounded-xl bg-ink text-white">
              <Microphone size={22} weight="fill" />
            </button>
          )}
        </div>
        <p className="flex items-center gap-2.5 px-1 pt-2.5 text-[15px] text-muted">
          <i className="size-2.5 flex-none rounded-full shadow-[inset_0_0_0_2.5px_var(--color-ink)]" />
          {fromLine(origin)}
        </p>
        <Segmented label="When to travel" className="mt-3.5" options={whenOptions} value={search.when} onChange={(when) => (when === "now" ? update({ when, at: null }) : setTimeMode(when))} />
        <Button className="mt-3.5" onClick={() => findRoutes(destination)}>
          {finding ? (
            <span className="flex gap-1.5" aria-label="Finding routes">
              {[0, 150, 300].map((delay) => (
                <i key={delay} className="size-[7px] animate-dot rounded-full bg-white" style={{ animationDelay: `${delay}ms` }} />
              ))}
            </span>
          ) : (
            "Find routes with less sun"
          )}
        </Button>

        <div className="mt-4 border-t border-line">
          {recents.length === 0 && (
            <div className="flex min-h-16 items-center gap-3 border-b border-line text-muted">
              <ClockCounterClockwise size={20} weight="bold" className="flex-none" />
              <span>
                <b className="block text-[16px] font-[650] text-ink">No trips yet</b>
                <span className="text-[14px]">Places you search for will show here.</span>
              </span>
            </div>
          )}
          {recents.map((place) => (
            <button key={place.name} type="button" onClick={() => findRoutes(place)} className="flex min-h-14 w-full items-center gap-3 border-b border-line">
              <ClockCounterClockwise size={20} weight="bold" className="flex-none text-muted" />
              <span className="min-w-0">
                <b className="block truncate text-[16px] leading-[1.3] font-semibold">{place.name}</b>
                <span className="text-[14px] text-muted">{searchedWhen(place.searchedAt)}</span>
              </span>
            </button>
          ))}
          <button type="button" onClick={() => navigate("/map")} className="flex min-h-14 w-full items-center gap-3 border-b border-line">
            <MapTrifold size={20} weight="bold" className="flex-none text-muted" />
            <span>
              <b className="block text-[16px] leading-[1.3] font-semibold">Shade map</b>
              <span className="text-[14px] text-muted">See which streets are shady at each hour</span>
            </span>
          </button>
        </div>
      </Sheet>

      {heatOpen && <HeatSheet place={origin} placeName={origin.name || "Your location"} at={nowIso} onClose={() => setHeatOpen(false)} />}
      {params.has("ask") && (
        <ChatPanel
          tripId={null}
          location={origin && { lat: origin.lat, lng: origin.lng }}
          about="Answers use SunSkip's real numbers for where you are."
          listen={params.get("ask") === "voice"}
          onClose={() => navigate(-1)}
        />
      )}
      {timeMode && (
        <TimeSheet
          search={{ ...search, when: timeMode }}
          onClose={() => setTimeMode("")}
          onPick={(time) => {
            update(time);
            setTimeMode("");
          }}
        />
      )}
    </main>
  );
}
