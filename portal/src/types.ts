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

// Portal (api.md §8). Unknown is null, never 0.
export type StretchPain = {
  stretchId: string;
  name: string | null;
  label: string | null; // described from what's nearby when OSM has no name
  lengthM: number;
  sunShare: number | null;
  walkersPerDay: number | null;
  walkersEstimated: boolean;
  painScore: number | null;
};

export type HeatPain = {
  shade: Shade;
  type: "FeatureCollection";
  features: { type: "Feature"; properties: StretchPain; geometry: { type: "LineString" | "MultiLineString"; coordinates: any[] } }[];
};

export type ItemType = "TREE" | "SHELTER";

export type Recommendation = {
  rank: number;
  type: ItemType;
  stretchId: string;
  count: number;
  positions: LatLng[];
  impact: { shadePctBefore: number | null; shadePctAfter: number | null; walkersPerDay: number | null; sunMinutesSavedPerDay: number | null };
  costInr: number;
  costEstimated: boolean;
  reason: string;
};

export type SimItem = {
  type: ItemType;
  location: LatLng;
  heightM: number;
  crownRadiusM?: number;
  widthM?: number;
  lengthM?: number;
  bearingDeg?: number;
};

export type Simulation = {
  byHour: { hour: number; shadePctBefore: number; shadePctAfter: number }[];
  segments: { id: string; sunFractionBefore: number | null; sunFractionAfter: number | null }[];
  sunMinutesSavedPerDay: number | null;
  approximation: boolean;
};

export type StretchEvidence = {
  stretchId: string;
  name: string | null;
  label: string | null;
  lengthM: number;
  segmentIds: string[];
  sunByMonthHour: (number | null)[][];
  walkers: { poiEstimate: number | null; appTrips30d: number | null; perDay: number | null };
};

export type UsageStats = {
  requests: number;
  okRequests: number;
  choiceRate: number | null;
  avgSunMinutesPerTrip: number | null;
  topOrigins: { location: LatLng; count: number }[];
};
