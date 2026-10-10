// Copied from docs/api.md §4. Change them there first.

export type LatLng = { lat: number; lng: number };
export type Place = { name: string | null; location: LatLng };
export type PlaceInput = LatLng | { query: string };

export type Shade = {
  status: "READY" | "PREPARING" | "UNAVAILABLE";
  jobId: string | null;
  reason?: "OUTSIDE_INDIA" | "NO_DATA" | "BUDGET" | null;
  cellsTotal?: number | null;
  cellsDone?: number | null;
  pollAfterSeconds?: number | null;
};

export type Exposure = {
  walkMeters: number;
  walkMinutes: number;
  sunMinutes: number | null;
  sunMinutesHot: number | null;
  waitSunMinutes: number | null;
  shadePct: number | null;
  heatDose: number | null;
  feelsLikeC: number | null;
};

export type Mode = "WALK" | "BUS" | "METRO" | "RAIL" | "ERICKSHAW";

export type Leg = {
  mode: Mode;
  from: Place;
  to: Place;
  startAt: string;
  endAt: string;
  distanceMeters: number;
  durationSeconds: number;
  polyline: { type: "LineString"; coordinates: [number, number][] };
  shadeKnown: boolean;
  coverage: "FULL" | "PARTIAL" | "NONE" | null;
  exposure: Exposure | null;
  line: { shortName: string | null; name: string | null; vehicle: Mode; headwaySeconds: number | null } | null;
  waitSeconds: number | null;
  stopShaded: boolean | null;
  fareInr: number | null;
  swappedFrom: "WALK" | null;
};

export type RouteLabel = "RECOMMENDED" | "FASTEST" | "CHEAPEST" | "COOLEST";
export type RouteWarning =
  | "HEAT_ALERT"
  | "FARE_ESTIMATED"
  | "LONG_WAIT_IN_SUN"
  | "SHADE_PREPARING"
  | "NO_SHADE_DATA"
  | "NO_SHADE_DATA_PARTIAL";

export type RouteOption = {
  optionId: string;
  labels: RouteLabel[];
  departAt: string;
  arriveAt: string;
  durationSeconds: number;
  fareInr: number | null;
  exposure: Exposure;
  legs: Leg[];
  warnings: RouteWarning[];
};

export type Waypoint = {
  index: number;
  location: LatLng;
  distanceFromStartM: number;
  legIndex: number;
  bearingDeg: number;
  inSun: boolean | null;
  cue: string | null;
};

export type Stretch = {
  stretchId: string;
  name: string;
  lengthM: number;
  geometry: object;
  walkersPerDay: number;
  sunShare: number;
  painScore: number;
};
