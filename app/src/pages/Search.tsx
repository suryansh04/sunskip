import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { ArrowLeft, Bus, Crosshair, MagnifyingGlass, MapPin, TrainSimple, XCircle } from "@phosphor-icons/react";
import places from "../api/fixtures/places.json";
import { api } from "../api/client";
import { fromLine } from "../format";
import { MUJ_MAIN_GATE, NEW_SEARCH, recall, remember } from "../session";
import { locate, ROUGH_M } from "../locate";
import MapView from "../components/MapView";
import TopBar from "../components/TopBar";
import RoundButton from "../components/RoundButton";
import Button from "../components/Button";

const USE_MOCKS = import.meta.env.VITE_USE_MOCKS === "true";
const PICK_ZOOM = 16;
const FOUND_ZOOM = 18; // close enough to check the pin is on the right side of the road
const MIN_QUERY_LETTERS = 2; // the API looks up names of 2 letters or more
const KIND_ICON = { metro: TrainSimple, bus: Bus, place: MapPin, typed: MagnifyingGlass };
const TYPE_PAUSE_MS = 250; // look names up once typing pauses
const KIND_WORD = { HOSTEL: "Hostel", ACADEMIC: "College or school", CAMPUS_GATE: "Campus gate", FOOD: "Food", SHOP: "Shop", OTHER: "Place", BUS: "Bus stop", METRO: "Metro station" };

function distanceWord(meters) {
  // Round in whole hundreds of metres first: toFixed alone turns 1150 m into "1.1 km" (1.15 is 1.1499… as a float)
  return meters < 1000 ? `${meters} m away` : `${(Math.round(meters / 100) / 10).toFixed(1)} km away`;
}

// A place from GET /places as a row of the list
function nearbyRow(place) {
  const kind = place.kind === "BUS" ? "bus" : place.kind === "METRO" ? "metro" : "place";
  return { name: place.name, area: `${KIND_WORD[place.kind] || "Place"} · ${distanceWord(place.distanceM)}`, kind, ...place.location };
}

// Destination search (screen 03): places near the start whose name matches (GET /places, from OSM),
// the demo places, whatever was typed (looked up by name), or a point picked on the map.
export default function Search() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState(() => recall("search") || NEW_SEARCH);
  const picking = params.get("pick");
  const start = search.origin || MUJ_MAIN_GATE;
  const [pin, setPin] = useState(start);
  const [view, setView] = useState({ center: [start.lng, start.lat], zoom: PICK_ZOOM });
  const [finding, setFinding] = useState(null); // { accuracyM } while the GPS settles
  const [findNote, setFindNote] = useState("");
  const stopFinding = useRef(null);
  const [nearby, setNearby] = useState([]);
  const [looking, setLooking] = useState(false);
  const [lookFailed, setLookFailed] = useState(false);
  const typed = query.trim();

  // Names of hostels, gates, stops and shops near the start, from OSM (GET /places); looked up again if the start moves
  useEffect(() => {
    setNearby([]);
    setLookFailed(false);
    setLooking(false);
    if (typed.length < MIN_QUERY_LETTERS) return;
    let current = true; // an answer for an older spelling is dropped
    setLooking(true);
    const timer = setTimeout(() => {
      api
        .get("/places", { params: { q: typed, lat: start.lat, lng: start.lng } })
        .then((res) => current && setNearby(res.data.places.map(nearbyRow)))
        .catch(() => current && setLookFailed(true))
        .finally(() => current && setLooking(false));
    }, TYPE_PAUSE_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [typed, start.lat, start.lng]);

  function save(change) {
    const next = { ...search, ...change };
    setSearch(next);
    remember("search", next);
  }

  useEffect(() => () => stopFinding.current?.(), []);

  function startHere(place) {
    save({ origin: { lat: place.lat, lng: place.lng, name: null, mine: true, foundAt: Date.now() } });
    setParams({}, { replace: true });
  }

  // "Use my current location": follow the GPS on the map while it settles, then start from it
  function useMyLocation() {
    if (USE_MOCKS) return startHere(MUJ_MAIN_GATE);
    stopFinding.current?.();
    setFindNote("");
    setFinding({ accuracyM: null });
    stopFinding.current = locate(
      (fix) => {
        setFinding({ accuracyM: fix.accuracyM });
        setPin(fix);
        setView({ center: [fix.lng, fix.lat], zoom: FOUND_ZOOM });
      },
      (best, failure) => {
        setFinding(null);
        if (!best) {
          setFindNote(failure === "denied" ? "Location is blocked for this site. Allow it in the browser's site settings, or move the map to your start." : "Couldn't find your location. Move the map to your start instead.");
          return;
        }
        if (best.accuracyM > ROUGH_M) {
          setFindNote(`Your phone shared only a rough location (±${Math.round(best.accuracyM)} m). Turn on Precise location for this browser, or move the map to your start.`);
          return;
        }
        startHere(best);
      },
    );
  }

  // Taking the pin, going back or moving the map by hand ends the GPS search, so a late fix can't override it
  function stopLooking() {
    stopFinding.current?.();
    stopFinding.current = null;
    setFinding(null);
  }

  function leavePicker() {
    stopLooking();
    setFindNote("");
    setParams({}, { replace: true });
  }

  function takePin() {
    stopLooking();
    if (picking === "from") {
      save({ origin: { lat: pin.lat, lng: pin.lng, name: "the pinned start", mine: false, pinned: true } });
      return setParams({}, { replace: true });
    }
    save({ destination: { name: "Pinned place", lat: pin.lat, lng: pin.lng } });
    navigate("/");
  }

  if (picking) {
    return (
      <main>
        <MapView
          camera={view}
          padding={{ top: 0, bottom: 0, left: 0, right: 0 }}
          streets={null}
          lines={null}
          start={null}
          end={null}
          you={null}
          creditBottom={picking === "from" ? 162 : 96}
          onMoved={(center) => {
            stopLooking();
            setPin(center);
          }}
        />
        <TopBar title={picking === "from" ? "Pick the start" : "Pick the destination"} subtitle="Move the map so the pin is on the place" onBack={leavePicker} />
        <MapPin size={44} weight="fill" aria-hidden className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-full text-ink" />
        <div className="absolute inset-x-4 bottom-[calc(16px+env(safe-area-inset-bottom))] flex flex-col gap-2.5">
          {findNote && <p className="rounded-[14px] bg-white px-4 py-3 text-[14px] text-alert shadow-[0_6px_20px_rgba(40,25,10,.15)]">{findNote}</p>}
          {picking === "from" && (
            <Button ghost disabled={finding !== null} onClick={useMyLocation} className="bg-white shadow-[0_6px_20px_rgba(40,25,10,.15)] disabled:opacity-100">
              <Crosshair size={20} weight="bold" className={finding ? "animate-pulse" : ""} />
              {!finding ? "Use my current location" : finding.accuracyM === null ? "Finding you…" : `Finding you… ±${Math.round(finding.accuracyM)} m`}
            </Button>
          )}
          <Button onClick={takePin}>Use this place</Button>
        </div>
      </main>
    );
  }

  const wanted = typed.toLowerCase();
  const builtIn = places.filter((place) => !wanted || place.name.toLowerCase().includes(wanted) || place.area.toLowerCase().includes(wanted));
  const matches = [...nearby, ...builtIn.filter((place) => !nearby.some((row) => row.name === place.name))];
  const exact = matches.some((place) => place.name.toLowerCase() === wanted);
  const rows = typed.length >= MIN_QUERY_LETTERS && !exact ? [...matches, { name: typed, area: "Look this name up", kind: "typed", query: typed }] : matches;

  function choose({ area, kind, ...place }) {
    save({ destination: place });
    navigate("/");
  }

  return (
    <main className="absolute inset-0 flex animate-forward flex-col overflow-y-auto bg-paper">
      <div className="flex items-center gap-2.5 px-4 pt-3.5">
        <RoundButton flat label="Back" onClick={() => navigate(-1)}>
          <ArrowLeft size={20} weight="bold" />
        </RoundButton>
        <div className="flex min-h-[52px] flex-1 items-center rounded-[14px] border-2 border-ink bg-white pr-1.5 pl-3.5">
          <label htmlFor="destination" className="sr-only">
            Where to?
          </label>
          <input
            id="destination"
            autoFocus
            autoComplete="off"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Where to?"
            className="min-w-0 flex-1 bg-transparent text-[17px] text-ink outline-none placeholder:text-muted"
          />
          {query && (
            <button type="button" aria-label="Clear" onClick={() => setQuery("")} className="grid size-10 place-items-center text-muted">
              <XCircle size={20} weight="fill" />
            </button>
          )}
        </div>
      </div>

      <div className="mx-5 mt-3 flex items-center gap-2.5 text-[15px] text-muted">
        <i className="size-2.5 flex-none rounded-full shadow-[inset_0_0_0_2.5px_var(--color-ink)]" />
        <span className="flex-1">{fromLine(search.origin)}</span>
        <button type="button" onClick={() => setParams({ pick: "from" })} className="min-h-10 font-[650] text-shade-text">
          Change
        </button>
      </div>

      <ul className="mx-4 mt-2.5 rounded-[14px] bg-white">
        {rows.map((place) => {
          const Icon = KIND_ICON[place.kind];
          return (
            <li key={place.kind + place.name} className="border-line not-first:border-t">
              <button type="button" onClick={() => choose(place)} className="flex min-h-[62px] w-full items-center gap-3 px-3.5 py-2">
                <span className="grid size-[38px] flex-none place-items-center rounded-[10px] bg-sunken">
                  <Icon size={19} weight="bold" />
                </span>
                <span className="min-w-0">
                  <b className="block truncate text-[16px] leading-[1.3] font-[650]">{place.name}</b>
                  <span className="text-[14px] text-muted">{place.area}</span>
                </span>
              </button>
            </li>
          );
        })}
        {looking && <li className="border-line px-4 py-3 text-[14px] text-muted not-first:border-t">Looking for places near you…</li>}
        {lookFailed && <li className="border-line px-4 py-3 text-[14px] text-muted not-first:border-t">Can't search places near you right now.</li>}
        {rows.length === 0 && <li className="p-4 text-[15px] text-muted">No places match. Type one more letter to look the name up, or pick the place on the map.</li>}
      </ul>

      <button type="button" onClick={() => setParams({ pick: "to" })} className="press m-4 mt-3 flex min-h-[52px] items-center gap-2.5 rounded-[14px] bg-sunken px-3.5 font-[650]">
        <MapPin size={20} weight="bold" />
        Pick the place on the map
      </button>
    </main>
  );
}
