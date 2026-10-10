import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

// Colours and widths from design.md §6
const SUN = "#F2994A";
const SHADE = "#2F80ED";
const UNKNOWN = "#B9AFA6";
const STREET_SUN = "#F5B47E";
const STREET_SHADE = "#86B4F4";
const STREET_UNKNOWN = "#CFC6BD";
const RIDE = "#3A302A";
const SUNNY_FROM = 0.5;
const MOVE_MS = 700;
const FIT_MAX_ZOOM = 17;
const NO_LINES = { type: "FeatureCollection", features: [] };
const ROUND = { "line-cap": "round", "line-join": "round" };

// The grey Positron style is warmed after it loads, so the sun and shade lines stand out
const BASEMAP = {
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

const START_PIN = `<svg width="20" height="20"><circle cx="10" cy="10" r="7" fill="#fff" stroke="#1F1A16" stroke-width="3.5"/></svg>`;
const END_PIN = `<svg width="26" height="26"><circle cx="13" cy="13" r="11" fill="#1F1A16"/><circle cx="13" cy="13" r="4" fill="#fff"/></svg>`;
// The blue dot is in the middle of its image, so the heading cone turns around it
const YOU_PIN = `<svg width="34" height="86" viewBox="0 0 34 86"><path d="M17 0 31 30H3Z" fill="rgba(47,128,237,.35)"/><circle cx="17" cy="43" r="11" fill="#2F80ED" stroke="#fff" stroke-width="4"/></svg>`;

const byZoom = (fromZoom, from, toZoom, to) => ["interpolate", ["linear"], ["zoom"], fromZoom, from, toZoom, to];
const byBit = ["match", ["get", "bit"], "s", SUN, "d", SHADE, UNKNOWN];
const isWalk = ["has", "bit"];
const isKind = (kind) => ["==", ["get", "kind"], kind];

function pin(html) {
  const element = document.createElement("div");
  element.innerHTML = html;
  return element;
}

function addLayers(map) {
  for (const [layer, [property, value]] of Object.entries(BASEMAP)) {
    if (map.getLayer(layer)) map.setPaintProperty(layer, property, value);
  }
  for (const source of ["streets", "trip"]) map.addSource(source, { type: "geojson", data: NO_LINES });
  const streetColor = ["case", ["==", ["get", "sunFraction"], null], STREET_UNKNOWN, [">=", ["get", "sunFraction"], SUNNY_FROM], STREET_SUN, STREET_SHADE];
  map.addLayer({ id: "streets", type: "line", source: "streets", layout: ROUND, paint: { "line-color": streetColor, "line-width": byZoom(14, 2, 18, 7) } });
  map.addLayer({ id: "ride-casing", type: "line", source: "trip", filter: ["!", isWalk], layout: ROUND, paint: { "line-color": "#fff", "line-width": byZoom(11, 6, 16, 14) } });
  map.addLayer({ id: "ride", type: "line", source: "trip", filter: isKind("ride"), layout: ROUND, paint: { "line-color": RIDE, "line-width": byZoom(11, 3, 16, 8) } });
  map.addLayer({ id: "erick", type: "line", source: "trip", filter: isKind("erick"), paint: { "line-color": RIDE, "line-width": byZoom(11, 3, 16, 7), "line-dasharray": [1.2, 1.2] } });
  map.addLayer({ id: "walk-casing", type: "line", source: "trip", filter: isWalk, layout: ROUND, paint: { "line-color": "#fff", "line-width": byZoom(14, 7, 18, 16) } });
  map.addLayer({ id: "walk", type: "line", source: "trip", filter: isWalk, layout: ROUND, paint: { "line-color": byBit, "line-width": byZoom(14, 4, 18, 10) } });
}

// One MapLibre map. `streets` is the /shade/segments answer; `lines` are the trip's pieces
// (walk pieces carry `bit`, rides carry `kind`). A new hour only calls setData.
// `camera` is { bounds, maxZoom } or { center, zoom, pitch, bearing }; `padding` keeps it clear of the sheet.
export default function MapView({ camera, padding, streets, streetOpacity = 1, lines, start, end, you, creditBottom, onMoved }) {
  const box = useRef(null);
  const mapRef = useRef(null);
  const markers = useRef({ start: null, end: null, you: null });
  const moved = useRef(onMoved);
  const [ready, setReady] = useState(false);
  moved.current = onMoved;

  useEffect(() => {
    const map = new maplibregl.Map({
      container: box.current,
      style: import.meta.env.VITE_MAP_STYLE_URL,
      center: camera.center || camera.bounds[0],
      zoom: camera.zoom || 14,
      minZoom: 9,
      attributionControl: false,
      fadeDuration: 0,
    });
    mapRef.current = map;
    map.on("load", () => {
      addLayers(map);
      setReady(true);
    });
    map.on("moveend", (event) => {
      if (event.originalEvent && moved.current) moved.current(map.getCenter());
    });
    return () => map.remove();
  }, []);

  useEffect(() => {
    if (!ready) return;
    mapRef.current.getSource("streets").setData(streets || NO_LINES);
  }, [ready, streets]);

  useEffect(() => {
    if (!ready) return;
    mapRef.current.setPaintProperty("streets", "line-opacity", streetOpacity);
  }, [ready, streetOpacity]);

  useEffect(() => {
    if (!ready) return;
    mapRef.current.getSource("trip").setData({ type: "FeatureCollection", features: lines || [] });
  }, [ready, lines]);

  useEffect(() => {
    if (!ready) return;
    const map = mapRef.current;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const duration = still ? 0 : MOVE_MS;
    if (camera.bounds) {
      map.fitBounds(camera.bounds, { padding, duration, maxZoom: camera.maxZoom || FIT_MAX_ZOOM, pitch: 0, bearing: 0 });
      return;
    }
    // An offset, not easeTo's padding: that one stays on the map and would be added to the next fitBounds
    const offset: [number, number] = [(padding.left - padding.right) / 2, (padding.top - padding.bottom) / 2];
    map.easeTo({ center: camera.center, zoom: camera.zoom, pitch: camera.pitch || 0, bearing: camera.bearing || 0, offset, duration });
  }, [ready, JSON.stringify(camera), JSON.stringify(padding)]);

  useEffect(() => {
    if (!ready) return;
    const places = { start: start && { at: start, html: START_PIN }, end: end && { at: end, html: END_PIN }, you: you && { ...you, html: YOU_PIN } };
    for (const [name, place] of Object.entries(places)) {
      if (!place) {
        markers.current[name]?.remove();
        markers.current[name] = null;
        continue;
      }
      const options: any = { element: pin(place.html), rotationAlignment: name === "you" ? "map" : "auto" };
      markers.current[name] = markers.current[name] || new maplibregl.Marker(options).setLngLat(place.at).addTo(mapRef.current);
      markers.current[name].setLngLat(place.at);
      if (name === "you") markers.current[name].setRotation(you.bearing);
    }
  }, [ready, JSON.stringify(start), JSON.stringify(end), JSON.stringify(you)]);

  return (
    <div className="absolute inset-0">
      <div ref={box} className="h-full w-full" />
      <span
        className="pointer-events-none absolute right-3 text-[12px] text-muted [text-shadow:0_0_3px_#fff,0_0_3px_#fff]"
        style={{ bottom: creditBottom }}
      >
        © OpenFreeMap © OpenStreetMap
      </span>
    </div>
  );
}
