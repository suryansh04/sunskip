import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { ArrowLeft, Bus, MagnifyingGlass, MapPin, TrainSimple, XCircle } from "@phosphor-icons/react";
import places from "../api/fixtures/places.json";
import { fromLine } from "../format";
import { MUJ_MAIN_GATE, NEW_SEARCH, recall, remember } from "../session";
import MapView from "../components/MapView";
import TopBar from "../components/TopBar";
import RoundButton from "../components/RoundButton";
import Button from "../components/Button";

const PICK_ZOOM = 16;
const MIN_QUERY_LETTERS = 2; // the API looks up names of 2 letters or more
const KIND_ICON = { metro: TrainSimple, bus: Bus, place: MapPin, typed: MagnifyingGlass };

// Destination search (screen 03). The API has no autocomplete, so the list is the demo places,
// whatever was typed (looked up by name), or a point picked on the map.
export default function Search() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState(() => recall("search") || NEW_SEARCH);
  const picking = params.get("pick");
  const start = search.origin || MUJ_MAIN_GATE;
  const [pin, setPin] = useState(start);

  function save(change) {
    const next = { ...search, ...change };
    setSearch(next);
    remember("search", next);
  }

  function takePin() {
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
          camera={{ center: [start.lng, start.lat], zoom: PICK_ZOOM }}
          padding={{ top: 0, bottom: 0, left: 0, right: 0 }}
          streets={null}
          lines={null}
          start={null}
          end={null}
          you={null}
          creditBottom={96}
          onMoved={setPin}
        />
        <TopBar title={picking === "from" ? "Pick the start" : "Pick the destination"} subtitle="Move the map so the pin is on the place" onBack={() => setParams({}, { replace: true })} />
        <MapPin size={44} weight="fill" aria-hidden className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-full text-ink" />
        <div className="absolute inset-x-4 bottom-[calc(16px+env(safe-area-inset-bottom))]">
          <Button onClick={takePin}>Use this place</Button>
        </div>
      </main>
    );
  }

  const typed = query.trim();
  const wanted = typed.toLowerCase();
  const matches = places.filter((place) => !wanted || place.name.toLowerCase().includes(wanted) || place.area.toLowerCase().includes(wanted));
  const exact = matches.some((place) => place.name.toLowerCase() === wanted);
  const rows = typed.length >= MIN_QUERY_LETTERS && !exact ? [{ name: typed, area: "Look this name up", kind: "typed", query: typed }, ...matches] : matches;

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
        {rows.length === 0 && <li className="p-4 text-[15px] text-muted">No places match. Type one more letter to look the name up, or pick the place on the map.</li>}
      </ul>

      <button type="button" onClick={() => setParams({ pick: "to" })} className="press m-4 mt-3 flex min-h-[52px] items-center gap-2.5 rounded-[14px] bg-sunken px-3.5 font-[650]">
        <MapPin size={20} weight="bold" />
        Pick the place on the map
      </button>
    </main>
  );
}
