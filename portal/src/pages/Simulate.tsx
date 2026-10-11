import { useEffect, useRef, useState } from "react";
import { useLocation, useOutletContext } from "react-router";
import { ArrowCounterClockwise, ArrowsClockwise, Compass, Cursor, HandPointing, HourglassMedium, Play, Tree, Umbrella, WarningCircle } from "@phosphor-icons/react";
import { api } from "../api/client";
import { PAIN_COLOR } from "../bands";
import { errorMessage, inr, reducedMotion } from "../format";
import { fitTo, flatCoords, setSource, showLayers } from "../map";
import { footprint, itemBlocks } from "../shapes";
import PanelHead from "../components/PanelHead";
import ItemEditor from "../components/ItemEditor";
import SimResult from "../components/SimResult";
import StateMessage from "../components/StateMessage";

// Sizes and costs of a new item, as in api/app/config.py (tree_*, shelter_*, *_cost_inr). Costs are estimates.
const NEW_TREE = { heightM: 6, crownRadiusM: 3 };
const NEW_SHELTER = { heightM: 3, widthM: 3, lengthM: 6 };
const COST_INR = { TREE: 3000, SHELTER: 60000 };
const MAX_ITEMS = 50;
const RUN = { month: 5, hours: [10, 16] };
const VIEW = { pitch: 60, bearing: -28 };
const VIEW_ZOOM = 18.8;
const REACH_M = 60; // paths this close to an item can get its shadow
const MAX_BOX_M = 950; // /shade/segments takes at most 1 km²
const METERS_PER_DEG = 111320;
const GROW_MS = 520;
const COUNT_MS = 700;
const LAYERS = ["buildings3d", "stretches", "changed", "items", "ground"];
const TOOLS = [
  { key: "move", label: "Select and move", icon: Cursor },
  { key: "TREE", label: "Add a tree", icon: Tree },
  { key: "SHELTER", label: "Add a shelter", icon: Umbrella },
];

function itemsFor(rec) {
  const size = rec.type === "TREE" ? NEW_TREE : { ...NEW_SHELTER, bearingDeg: 0 };
  return rec.positions.map((location) => ({ type: rec.type, location: { ...location }, ...size }));
}

// What POST /portal/simulate takes for one item
function asRequest(item) {
  if (item.type === "TREE") return { type: "TREE", location: item.location, heightM: item.heightM, crownRadiusM: item.crownRadiusM };
  return { type: "SHELTER", location: item.location, heightM: item.heightM, widthM: item.widthM, lengthM: item.lengthM, bearingDeg: item.bearingDeg };
}

// The paths around the items, for drawing the ones whose shade changed
function boxAround(items) {
  const lngs = items.map((item) => item.location.lng);
  const lats = items.map((item) => item.location.lat);
  const midLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const kx = METERS_PER_DEG * Math.cos((midLat * Math.PI) / 180);
  const halfX = Math.min(((Math.max(...lngs) - Math.min(...lngs)) * kx) / 2 + REACH_M, MAX_BOX_M / 2) / kx;
  const halfY = Math.min(((Math.max(...lats) - Math.min(...lats)) * METERS_PER_DEG) / 2 + REACH_M, MAX_BOX_M / 2) / METERS_PER_DEG;
  return [midLng - halfX, midLat - halfY, midLng + halfX, midLat + halfY].map((n) => n.toFixed(6)).join(",");
}

// What-if simulator (P5): try trees and shelters in 3D and see the shade they would add
export default function Simulate() {
  const { map, area } = useOutletContext<any>();
  const location = useLocation();
  const start = location.state || {};
  const [rec, setRec] = useState(null);
  const [name, setName] = useState("");
  const [stretchLine, setStretchLine] = useState(null);
  const [items, setItems] = useState([]);
  const [sel, setSel] = useState(null);
  const [tool, setTool] = useState("move");
  const [status, setStatus] = useState("loading"); // loading, idle, running, done, error, preparing, noData
  const [errorText, setErrorText] = useState("");
  const [result, setResult] = useState(null);
  const [paths, setPaths] = useState({});
  const [view, setView] = useState("after");
  const [grown, setGrown] = useState(false);
  const [counted, setCounted] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const live = useRef({ items, tool, sel });
  live.current = { items, tool, sel };
  const growing = useRef(null); // { index, grow } while a new item rises
  const firstLoad = useRef(true);

  // The plan to start from: the recommendation that opened the simulator, or this area's best tree plan
  useEffect(() => {
    const given = firstLoad.current && start.rec ? start.rec : null;
    firstLoad.current = false;
    setStatus("loading");
    const recsCall = given ? Promise.resolve(null) : api.get("/portal/recommendations", { params: { bbox: area.bbox, type: "TREE" } });
    Promise.all([recsCall, api.get("/portal/heat-pain", { params: { bbox: area.bbox, month: 5, hours: "10-16", limit: 50 } })])
      .then(([recRes, painRes]) => {
        const stretches = Object.fromEntries(painRes.data.features.map((feature) => [feature.properties.stretchId, feature]));
        const all = recRes ? recRes.data.recommendations : [];
        const chosen = given || all.find((candidate) => candidate.stretchId === start.stretchId) || all[0] || null;
        setRec(chosen);
        setItems(chosen ? itemsFor(chosen) : []);
        setName(chosen ? stretches[chosen.stretchId]?.properties.name || "Unnamed path" : "");
        setStretchLine(chosen ? stretches[chosen.stretchId]?.geometry || null : null);
        setSel(null);
        setResult(null);
        setDirty(false);
        setStatus("idle");
      })
      .catch((err) => {
        setErrorText(errorMessage(err));
        setStatus(err.response?.status === 409 ? "preparing" : "error");
      });
  }, [area.key, attempt]);

  function draw() {
    if (!map) return;
    const { items: all, sel: selected } = live.current;
    const grow = growing.current;
    setSource(map, "items", all.flatMap((item, i) => itemBlocks(item, i, i === selected, grow?.index === i ? grow.grow : 1)));
    setSource(map, "ground", all[selected] ? [footprint(all[selected])] : []);
  }

  // The 3D view: buildings, the stretch being shaded, and the items
  useEffect(() => {
    if (!map) return;
    showLayers(map, LAYERS);
    map.setPaintProperty("stretches", "line-color", "#E8590C");
    map.setPaintProperty("stretches", "line-opacity", 0.55);
    return () => {
      map.setPaintProperty("stretches", "line-color", PAIN_COLOR);
      map.setPaintProperty("stretches", "line-opacity", 1);
      for (const source of ["stretches", "items", "ground", "changed"]) setSource(map, source, []);
      map.easeTo({ pitch: 0, bearing: 0, duration: reducedMotion() ? 0 : 600 });
    };
  }, [map]);

  useEffect(() => {
    if (map) setSource(map, "stretches", stretchLine ? [{ type: "Feature", properties: { id: rec?.stretchId, pain: null }, geometry: stretchLine }] : []);
  }, [map, stretchLine]);

  useEffect(draw, [map, items, sel]);

  useEffect(() => {
    if (map && status === "idle" && !result) resetView();
  }, [map, rec, status]);

  // The paths whose shade changed, coloured by their sun before or after
  useEffect(() => {
    if (!map) return;
    const changed = (result?.segments || []).filter((segment) => paths[segment.id]);
    setSource(
      map,
      "changed",
      changed.map((segment) => ({ type: "Feature", properties: { sun: view === "after" ? segment.sunFractionAfter : segment.sunFractionBefore }, geometry: paths[segment.id] })),
    );
  }, [map, result, paths, view]);

  // Mouse: click a path to add the chosen item; with the move tool, press an item to select it and drag it
  useEffect(() => {
    if (!map) return;
    let dragging = null;
    const down = (event) => {
      if (live.current.tool !== "move") return;
      const hit = map.queryRenderedFeatures(event.point, { layers: ["items"] })[0];
      if (!hit) return setSel(null);
      event.preventDefault();
      dragging = hit.properties.index;
      setSel(dragging);
      map.dragPan.disable();
    };
    const move = (event) => {
      if (dragging === null) {
        const over = live.current.tool === "move" && map.queryRenderedFeatures(event.point, { layers: ["items"] }).length;
        map.getCanvas().style.cursor = live.current.tool !== "move" ? "crosshair" : over ? "grab" : "";
        return;
      }
      const to = { lat: event.lngLat.lat, lng: event.lngLat.lng };
      setItems((all) => all.map((item, i) => (i === dragging ? { ...item, location: to } : item)));
      setDirty(true);
    };
    const up = () => {
      if (dragging === null) return;
      dragging = null;
      map.dragPan.enable();
    };
    const click = (event) => {
      const { tool: chosen, items: all } = live.current;
      if (chosen === "move" || all.length >= MAX_ITEMS) return;
      const at = { lat: event.lngLat.lat, lng: event.lngLat.lng };
      const item = chosen === "TREE" ? { type: "TREE", location: at, ...NEW_TREE } : { type: "SHELTER", location: at, ...NEW_SHELTER, bearingDeg: Math.round((360 - map.getBearing()) % 180) };
      setItems([...all, item]);
      setSel(all.length);
      setDirty(true);
      grow(all.length);
    };
    map.on("mousedown", down);
    map.on("mousemove", move);
    map.on("mouseup", up);
    map.on("click", click);
    return () => {
      map.off("mousedown", down);
      map.off("mousemove", move);
      map.off("mouseup", up);
      map.off("click", click);
      map.getCanvas().style.cursor = "";
      map.dragPan.enable();
    };
  }, [map]);

  // New items rise out of the ground
  function grow(index) {
    if (reducedMotion()) return;
    const started = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - started) / GROW_MS);
      growing.current = t < 1 ? { index, grow: Math.max(0.05, 1 - Math.pow(1 - t, 3)) } : null;
      draw();
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function countUp(target) {
    if (target === null || reducedMotion()) return setCounted(target || 0);
    const started = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - started) / COUNT_MS);
      setCounted(Math.round(target * (1 - Math.pow(1 - t, 3))));
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function resetView() {
    const line = stretchLine ? flatCoords(stretchLine) : [];
    const coords = [...items.map((item) => [item.location.lng, item.location.lat]), ...line];
    if (coords.length) fitTo(map, coords, VIEW_ZOOM, VIEW);
    else map.easeTo({ center: area.center, zoom: 17, ...VIEW, duration: reducedMotion() ? 0 : 1000 });
  }

  function edit(field, value) {
    setItems(items.map((item, i) => (i === sel ? { ...item, [field]: value } : item)));
    setDirty(true);
  }

  function remove() {
    setItems(items.filter((_, i) => i !== sel));
    setSel(null);
    setDirty(true);
  }

  function reset() {
    setItems(rec ? itemsFor(rec) : []);
    setSel(null);
    setResult(null);
    setDirty(false);
    setStatus("idle");
  }

  function run() {
    setStatus("running");
    setGrown(false);
    setSel(null);
    const box = boxAround(items);
    Promise.all([api.post("/portal/simulate", { ...RUN, items: items.map(asRequest) }), api.get("/shade/segments", { params: { bbox: box, month: RUN.month, hour: 13 } }).catch(() => null)])
      .then(([sim, segments]) => {
        if (segments) setPaths(Object.fromEntries(segments.data.features.map((feature) => [feature.properties.id, feature.geometry])));
        setResult(sim.data);
        setView("before");
        setDirty(false);
        setStatus("done");
        // the paths turn from before to after, the bars grow and the number counts up together
        setTimeout(
          () => {
            setGrown(true);
            setView("after");
            countUp(sim.data.sunMinutesSavedPerDay);
          },
          reducedMotion() ? 0 : 120,
        );
      })
      .catch((err) => {
        setErrorText(errorMessage(err));
        const code = err.response?.data?.error?.code;
        setStatus(code === "SHADE_PREPARING" ? "preparing" : code === "NO_SHADE_DATA" ? "noData" : "error");
      });
  }

  const count = (type) => items.filter((item) => item.type === type).length;
  const cost = items.reduce((sum, item) => sum + COST_INR[item.type], 0);
  const selected = items[sel];

  return (
    <aside className="flex min-h-0 flex-col border-l-2 border-ink bg-white">
      <PanelHead title="Simulator">
        {rec ? `Starting from recommendation ${rec.rank}: ${name}. Move, add or resize items, then run it.` : "Add trees or shelters on a path, then run it to see the shade they add."}
      </PanelHead>
      <div className="flex border-b border-line">
        {[
          ["Trees", count("TREE")],
          ["Shelters", count("SHELTER")],
          ["Cost (estimate)", `₹${inr(cost)}`],
          ["Shade for", "May, 10 – 4"],
        ].map(([label, value]) => (
          <div key={label} className="flex min-h-[62px] flex-1 flex-col justify-center border-r border-line px-4 py-2.5 text-[12.5px] text-muted last:border-r-0">
            {label}
            <b className="text-[15px] text-ink">{value}</b>
          </div>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {selected && <ItemEditor item={selected} onChange={edit} onRemove={remove} />}
        {status === "loading" && <p className="px-6.5 py-5 text-muted">Loading the plan to start from…</p>}
        {status === "idle" && !selected && (
          <p className="px-6.5 pt-4 pb-6 text-[13px] leading-normal text-muted">
            Click a tree or shelter on the map to resize it. Shade is worked out from the sun's position on 15 May, hour by hour from 10 AM to 4 PM.
          </p>
        )}
        {status === "running" && (
          <div className="flex items-center gap-3 px-6.5 py-5.5 font-semibold">
            <span className="size-5 animate-spin rounded-full border-3 border-line border-t-ink" />
            Working out the shade hour by hour…
          </div>
        )}
        {status === "done" && result && <SimResult result={result} counted={counted} grown={grown} />}
        {status === "preparing" && (
          <StateMessage icon={<HourglassMedium size={40} weight="bold" />} title="Getting this area ready" text="Shade data around these items is being fetched. Run it again in a few minutes." />
        )}
        {status === "noData" && (
          <StateMessage icon={<WarningCircle size={40} weight="bold" />} title="No shade data here" text="Google has no shade data for the paths around these items, so the simulator can't work out the shade." />
        )}
        {status === "error" && (
          <StateMessage icon={<WarningCircle size={40} weight="bold" />} title="Can't run the simulation" text={`${errorText}. Check your connection and try again.`}>
            <button type="button" onClick={() => (items.length ? run() : setAttempt((n) => n + 1))} className="flex min-h-[46px] items-center gap-2 bg-ink px-5 font-bold text-white">
              <ArrowsClockwise size={18} weight="bold" />
              Try again
            </button>
          </StateMessage>
        )}
      </div>

      <div className="flex border-t-2 border-ink">
        <button
          type="button"
          onClick={run}
          disabled={!items.length || status === "running" || status === "loading"}
          className="flex min-h-14 flex-1 items-center justify-center gap-2 bg-ink text-[16px] font-bold text-white hover:bg-[#2E2723] disabled:opacity-40"
        >
          <Play size={18} weight="fill" />
          {status === "done" && !dirty ? "Run again" : "Run simulation"}
        </button>
        <button type="button" onClick={reset} className="flex min-h-14 w-[120px] items-center justify-center gap-2 bg-white font-bold shadow-[inset_0_0_0_2px_var(--color-ink)] hover:bg-hover">
          <ArrowCounterClockwise size={18} weight="bold" />
          Reset
        </button>
      </div>

      {/* Map overlays: the panel has no position of its own, so these are placed in <main> over the map */}
      <div role="toolbar" aria-label="Simulator tools" className="absolute top-5 left-5 z-[3] flex flex-col bg-ink">
        {TOOLS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            aria-label={label}
            title={label}
            aria-pressed={tool === key}
            onClick={() => setTool(key)}
            className={`grid size-[50px] place-items-center border-b border-barline ${tool === key ? "bg-white text-ink" : "text-bartext hover:text-white"}`}
          >
            <Icon size={23} weight="bold" />
          </button>
        ))}
        <button type="button" aria-label="Reset the 3D view" title="Reset the 3D view" onClick={resetView} className="grid size-[50px] place-items-center text-bartext hover:text-white">
          <Compass size={23} weight="bold" />
        </button>
      </div>
      {status === "done" && (
        <div className="absolute top-5 right-[580px] z-[3] flex border-2 border-ink bg-white">
          {["before", "after"].map((which) => (
            <button key={which} type="button" aria-pressed={view === which} onClick={() => setView(which)} className={`px-4 py-2 text-[14px] font-bold capitalize ${view === which ? "bg-ink text-white" : ""}`}>
              {which}
            </button>
          ))}
        </div>
      )}
      <div className="absolute bottom-6 left-[calc((100%-560px)/2)] z-[3] flex -translate-x-1/2 items-center gap-2 border-2 border-ink bg-white px-3.5 py-2 text-[13.5px] whitespace-nowrap">
        <HandPointing size={18} weight="bold" />
        {tool === "move" ? "Drag a tree or shelter to move it · right-drag to turn the view" : `Click a path to add a ${tool === "TREE" ? "tree" : "shelter"}`}
      </div>
    </aside>
  );
}
