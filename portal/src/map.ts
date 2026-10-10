import maplibregl from "maplibre-gl";
import { PAIN_COLOR, PAIN_WIDTH } from "./bands";
import { reducedMotion } from "./format";

// One map for every tab (design.md §12). Each page shows the layers it needs and fills their sources.
const NO_FEATURES = { type: "FeatureCollection", features: [] };
const PAGE_LAYERS = ["buildings3d", "streets", "stretch-hit", "stretch-hi", "stretches", "changed", "pins", "ground", "items", "origins"];
const FIT_PADDING = { top: 90, bottom: 110, left: 90, right: 90 };
const MOVE_MS = 1000;

// Positron recoloured to neutral greys, so only the pain colours carry meaning
const BASEMAP = {
  background: ["background-color", "#F7F5F2"],
  park: ["fill-color", "#E9EDE3"],
  water: ["fill-color", "#D5E2EA"],
  landuse_residential: ["fill-color", "#F2EFEA"],
  landcover_wood: ["fill-color", "#E5EADD"],
  building: ["fill-color", "#E7E2DA"],
  highway_minor: ["line-color", "#FFFFFF"],
  highway_path: ["line-color", "#FFFFFF"],
  highway_major_casing: ["line-color", "#D8D1C7"],
  highway_motorway_casing: ["line-color", "#D8D1C7"],
  "highway-name-minor": ["text-color", "#857A70"],
  "highway-name-major": ["text-color", "#857A70"],
  label_village: ["text-color", "#2E2723"],
  label_town: ["text-color", "#2E2723"],
  label_other: ["text-color", "#4A4038"],
};

const byZoom = (fromZoom, from, toZoom, to) => ["interpolate", ["linear"], ["zoom"], fromZoom, from, toZoom, to];

export function featureCollection(features) {
  return { type: "FeatureCollection", features };
}

export function recolourBasemap(map) {
  for (const [layer, [property, value]] of Object.entries(BASEMAP)) {
    if (map.getLayer(layer)) map.setPaintProperty(layer, property, value);
  }
}

export function addPortalLayers(map) {
  recolourBasemap(map);
  const sources = ["streets", "stretches", "changed", "pins", "ground", "items", "origins"];
  for (const source of sources) map.addSource(source, { type: "geojson", data: NO_FEATURES });
  map.addLayer({
    id: "buildings3d",
    type: "fill-extrusion",
    source: "openmaptiles",
    "source-layer": "building",
    minzoom: 14,
    paint: {
      "fill-extrusion-color": "#E4DED6",
      "fill-extrusion-height": ["coalesce", ["get", "render_height"], 6],
      "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
      "fill-extrusion-opacity": 0.8,
    },
  });
  map.addLayer({ id: "streets", type: "line", source: "streets", paint: { "line-color": "#DCD4CA", "line-width": byZoom(14, 1, 18, 4) } });
  map.addLayer({ id: "stretch-hit", type: "line", source: "stretches", paint: { "line-color": "#000", "line-opacity": 0, "line-width": 16 } });
  map.addLayer({ id: "stretch-hi", type: "line", source: "stretches", filter: ["==", ["get", "id"], ""], paint: { "line-color": "#141110", "line-width": byZoom(13, 10, 18, 22) } });
  map.addLayer({
    id: "stretches",
    type: "line",
    source: "stretches",
    layout: { "line-join": "miter", "line-sort-key": ["coalesce", ["get", "pain"], 0] },
    paint: { "line-color": PAIN_COLOR, "line-width": byZoom(13, ["*", 0.8, PAIN_WIDTH], 18, ["*", 2, PAIN_WIDTH]) },
  });
  map.addLayer({
    id: "changed",
    type: "line",
    source: "changed",
    paint: { "line-color": ["interpolate", ["linear"], ["get", "sun"], 0, "#2F80ED", 0.5, "#9DB9E0", 0.75, "#F5B47E", 1, "#F2994A"], "line-width": byZoom(15, 3, 19, 11) },
  });
  map.addLayer({
    id: "pins",
    type: "circle",
    source: "pins",
    layout: { "circle-sort-key": ["get", "open"] },
    paint: {
      "circle-radius": byZoom(14, ["+", 2.5, ["*", 2, ["get", "open"]]], 18, ["+", 5, ["*", 5, ["get", "open"]]]),
      "circle-color": ["get", "color"],
      "circle-stroke-color": "#fff",
      "circle-stroke-width": ["+", 1, ["get", "open"]],
    },
  });
  map.addLayer({ id: "ground", type: "fill", source: "ground", paint: { "fill-color": "#141110", "fill-opacity": 0.16 } });
  map.addLayer({
    id: "items",
    type: "fill-extrusion",
    source: "items",
    paint: { "fill-extrusion-color": ["get", "color"], "fill-extrusion-base": ["get", "base"], "fill-extrusion-height": ["get", "top"], "fill-extrusion-opacity": 1 },
  });
  map.addLayer({
    id: "origins",
    type: "circle",
    source: "origins",
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["get", "share"], 0, 6, 1, 32],
      "circle-color": "#141110",
      "circle-opacity": 0.85,
      "circle-stroke-color": "#fff",
      "circle-stroke-width": 2,
    },
  });
  showLayers(map, []);
}

// Show only these page layers; the others are hidden and emptied by their own page
export function showLayers(map, ids) {
  for (const id of PAGE_LAYERS) map.setLayoutProperty(id, "visibility", ids.includes(id) ? "visible" : "none");
}

export function setSource(map, source, features) {
  map.getSource(source)?.setData(featureCollection(features));
}

export function flatCoords(geometry) {
  return geometry.type === "LineString" ? geometry.coordinates : geometry.coordinates.flat();
}

export function fitTo(map, coords, maxZoom, extra = {}) {
  if (!coords.length) return;
  const bounds = new maplibregl.LngLatBounds(coords[0], coords[0]);
  for (const coord of coords) bounds.extend(coord);
  map.fitBounds(bounds, { padding: FIT_PADDING, maxZoom, duration: reducedMotion() ? 0 : MOVE_MS, ...extra });
}

export function flyTo(map, center, zoom) {
  map.easeTo({ center, zoom, pitch: 0, bearing: 0, duration: reducedMotion() ? 0 : MOVE_MS });
}

// The point halfway along a stretch, where its rank tag sits
export function midpoint(geometry) {
  const points = flatCoords(geometry);
  const apart = (a, b) => Math.hypot((a[0] - b[0]) * Math.cos((a[1] * Math.PI) / 180), a[1] - b[1]);
  const total = points.slice(1).reduce((sum, point, i) => sum + apart(points[i], point), 0);
  let run = 0;
  for (let i = 1; i < points.length; i++) {
    const step = apart(points[i - 1], points[i]);
    if (run + step >= total / 2) {
      const t = (total / 2 - run) / step;
      return [points[i - 1][0] + (points[i][0] - points[i - 1][0]) * t, points[i - 1][1] + (points[i][1] - points[i - 1][1]) * t];
    }
    run += step;
  }
  return points[0];
}
