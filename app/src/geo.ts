// Distances, map boxes and the walking maths on a list of waypoints (api.md endpoint 7).

export const WALK_SPEED_MPS = 1.2; // api.md §11
const TURN_MIN_DEG = 30; // a bend of 30° or more is a turn, as in the API's cues
const SUNNY_FROM = 0.5; // a street counts as sunny when at least half of it is in sun
const BOX_HALF_M = 450; // /shade/segments takes at most 1 km²
const METERS_PER_DEG = 111320;
const COMPASS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];

export function metersBetween(a, b) {
  const shrink = Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  return METERS_PER_DEG * Math.hypot((b.lng - a.lng) * shrink, b.lat - a.lat);
}

// 249 -> "west"
export function compassWord(deg) {
  return COMPASS[Math.round(deg / 45) % 8];
}

// How far to turn from one bearing to another: -180..180, right is positive
export function turnBetween(from, to) {
  return ((to - from + 540) % 360) - 180;
}

// [[west, south], [east, north]] of the box that reaches halfM from a point
export function boxAround(center, halfM = BOX_HALF_M) {
  const lat = halfM / METERS_PER_DEG;
  const lng = lat / Math.cos((center.lat * Math.PI) / 180);
  return [
    [center.lng - lng, center.lat - lat],
    [center.lng + lng, center.lat + lat],
  ];
}

// The same box as "w,s,e,n", the bbox that /shade/segments takes
export function bboxAround(center) {
  return boxAround(center).flat().map((n) => n.toFixed(6)).join(",");
}

// [[west, south], [east, north]] of [lng, lat] points
export function boundsOf(coords) {
  const lngs = coords.map((c) => c[0]);
  const lats = coords.map((c) => c[1]);
  return [
    [Math.min(...lngs), Math.min(...lats)],
    [Math.max(...lngs), Math.max(...lats)],
  ];
}

// Share of streets in sun, in %. null when no street has shade data.
export function sunnyShare(features) {
  const known = features.filter((feature) => feature.properties.sunFraction !== null);
  if (!known.length) return null;
  return Math.round((100 * known.filter((feature) => feature.properties.sunFraction >= SUNNY_FROM).length) / known.length);
}

// "s" sun, "d" shade, "u" unknown
export function sunBit(inSun) {
  return inSun === true ? "s" : inSun === false ? "d" : "u";
}

// The API's own distance along the walk, so the numbers add up the way its sun minutes do
function pieceMeters(points, i) {
  return points[i + 1].distanceFromStartM - points[i].distanceFromStartM;
}

function line(coordinates, properties) {
  return { type: "Feature", properties, geometry: { type: "LineString", coordinates } };
}

// The walk as map lines, one piece per pair of waypoints, coloured by the first one's sun
export function walkPieces(points) {
  return points.slice(0, -1).map((point, i) => {
    const next = points[i + 1].location;
    return line([[point.location.lng, point.location.lat], [next.lng, next.lat]], { bit: sunBit(point.inSun) });
  });
}

// Every leg of an option as map lines: rides in ink, walks by sun (grey until the waypoints are in)
export function optionLines(option, points) {
  return option.legs.flatMap((leg, legIndex) => {
    if (leg.mode !== "WALK") return [line(leg.polyline.coordinates, { kind: leg.mode === "ERICKSHAW" ? "erick" : "ride" })];
    const legPoints = points.filter((point) => point.legIndex === legIndex);
    if (legPoints.length < 2) return [line(leg.polyline.coordinates, { bit: "u" })];
    return walkPieces(legPoints);
  });
}

export function metersLeft(points, at) {
  let meters = 0;
  for (let i = at; i < points.length - 1; i++) meters += pieceMeters(points, i);
  return meters;
}

// api.md: sun minutes = metres in sun ÷ 1.2 m/s ÷ 60. null when any piece ahead is unknown.
export function sunMinutesLeft(points, at) {
  let meters = 0;
  for (let i = at; i < points.length - 1; i++) {
    if (points[i].inSun === null) return null;
    if (points[i].inSun) meters += pieceMeters(points, i);
  }
  return meters / WALK_SPEED_MPS / 60;
}

// The next instruction from waypoint `at`: keep going while the path stays within 30°, then turn
export function nextInstruction(points, at) {
  const heading = points[at].bearingDeg;
  let i = at;
  let meters = 0;
  while (i < points.length - 1 && Math.abs(turnBetween(heading, points[i].bearingDeg)) < TURN_MIN_DEG) {
    meters += pieceMeters(points, i);
    i++;
  }
  const arrives = i >= points.length - 1;
  const then = arrives ? "arrive" : turnBetween(heading, points[i].bearingDeg) > 0 ? "turn right" : "turn left";
  return { heading, title: `${at === 0 ? "Head" : "Continue"} ${compassWord(heading)}`, meters: Math.round(meters / 10) * 10, then };
}

// How far the current run of sun or shade goes from waypoint `at`, and what comes after it
export function stretchAhead(points, at) {
  const bit = sunBit(points[at].inSun);
  let i = at;
  let meters = 0;
  while (i < points.length - 1 && sunBit(points[i].inSun) === bit) {
    meters += pieceMeters(points, i);
    i++;
  }
  const next = i < points.length - 1 ? sunBit(points[i].inSun) : null;
  return { bit, meters: Math.round(meters / 5) * 5, next };
}
