import { DEFAULT_SHELTER, DEFAULT_TREE, SHELTERS, YOUNG_TREE } from "./costs";

const SHELTER_HEIGHT_M = 3; // api/app/config.py shelter_height_m
const REACH_M = 60; // paths this close to an item can get its shadow
const MAX_BOX_M = 950; // /shade/segments takes at most 1 km²
const METERS_PER_DEG = 111320;

// A new item of a kind: trees start young (as the recommendations assume), shelters at their type's size
export function newItem(type, kind, location, bearingDeg = 0) {
  if (type === "TREE") return { type, kind, location, ...YOUNG_TREE };
  const shelter = SHELTERS.find((choice) => choice.key === kind);
  return { type, kind, location, heightM: SHELTER_HEIGHT_M, widthM: shelter.widthM, lengthM: shelter.lengthM, bearingDeg };
}

// A recommendation's items, marked as proposed until someone moves or changes them
export function itemsFor(rec) {
  return rec.positions.map((location) => ({ ...newItem(rec.type, rec.type === "TREE" ? DEFAULT_TREE : DEFAULT_SHELTER, { ...location }), proposed: true }));
}

// What POST /portal/simulate takes for one item
export function asRequest(item) {
  if (item.type === "TREE") return { type: "TREE", location: item.location, heightM: item.heightM, crownRadiusM: item.crownRadiusM };
  return { type: "SHELTER", location: item.location, heightM: item.heightM, widthM: item.widthM, lengthM: item.lengthM, bearingDeg: item.bearingDeg };
}

// The paths around the items, for drawing the ones whose shade changed
export function boxAround(items) {
  const lngs = items.map((item) => item.location.lng);
  const lats = items.map((item) => item.location.lat);
  const midLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const kx = METERS_PER_DEG * Math.cos((midLat * Math.PI) / 180);
  const halfX = Math.min(((Math.max(...lngs) - Math.min(...lngs)) * kx) / 2 + REACH_M, MAX_BOX_M / 2) / kx;
  const halfY = Math.min(((Math.max(...lats) - Math.min(...lats)) * METERS_PER_DEG) / 2 + REACH_M, MAX_BOX_M / 2) / METERS_PER_DEG;
  return [midLng - halfX, midLat - halfY, midLng + halfX, midLat + halfY].map((n) => n.toFixed(6)).join(",");
}

function counted(count, word) {
  return count ? `${count} new ${word}${count === 1 ? "" : "s"}` : null;
}

// What the plan on the map is, so nobody mistakes it for the trees and shelters standing there today
export function planNote(items, rec) {
  if (!items.length) return null;
  const trees = counted(items.filter((item) => item.type === "TREE").length, "tree");
  const shelters = counted(items.filter((item) => item.type === "SHELTER").length, "shelter");
  return { from: rec ? `Proposed · recommendation ${rec.rank}` : "Your plan", what: [trees, shelters].filter(Boolean).join(", ") };
}
