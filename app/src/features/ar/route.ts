import type { Waypoint } from './types.ts'
import { SNAP_MAX_OFFSET_M, SNAP_SEARCH_AHEAD_M, SNAP_SEARCH_BACK_M } from './config.ts'
import { deltaDeg, EARTH_RADIUS_M, normalizeDeg } from './geo.ts'
import type { LatLng } from './geo.ts'

const DEG = Math.PI / 180

/** Metres east (x) and north (y) of the first waypoint. */
interface Flat {
  x: number
  y: number
}

/** The waypoints as a polyline, with distances measured along it ("progress"). */
export interface Route {
  readonly waypoints: readonly Waypoint[]
  /** Progress at each waypoint, in metres. */
  readonly distances: readonly number[]
  readonly lengthM: number
  /** How far the route turns at each waypoint, in degrees: positive = right. 0 at both ends. */
  readonly turns: readonly number[]
  /** Runs of consecutive segments with the same sun/shade state, in order. */
  readonly stretches: readonly Stretch[]
  readonly origin: LatLng
  readonly flat: readonly Flat[]
}

/** A run of the route that is all sun, all shade, or all unknown. */
export interface Stretch {
  startM: number
  endM: number
  inSun: boolean | null
}

export interface RouteSnap {
  /** Metres along the route of the closest point. */
  progressM: number
  /** How far the fix was from the route. */
  offsetM: number
  /** The closest point on the route. */
  point: LatLng
}

function toFlat(origin: LatLng, point: LatLng): Flat {
  return {
    x: EARTH_RADIUS_M * (point.lng - origin.lng) * DEG * Math.cos(origin.lat * DEG),
    y: EARTH_RADIUS_M * (point.lat - origin.lat) * DEG,
  }
}

function fromFlat(origin: LatLng, flat: Flat): LatLng {
  return {
    lat: origin.lat + flat.y / EARTH_RADIUS_M / DEG,
    lng: origin.lng + flat.x / (EARTH_RADIUS_M * Math.cos(origin.lat * DEG)) / DEG,
  }
}

/** Null if there are too few waypoints to make a path. */
export function buildRoute(waypoints: readonly Waypoint[]): Route | null {
  if (waypoints.length < 2) return null
  const origin = waypoints[0].location
  const flat = waypoints.map((waypoint) => toFlat(origin, waypoint.location))
  const distances = [0]
  for (let i = 1; i < flat.length; i++) {
    distances.push(
      distances[i - 1] + Math.hypot(flat[i].x - flat[i - 1].x, flat[i].y - flat[i - 1].y),
    )
  }
  const headingOut = (i: number) =>
    Math.atan2(flat[i + 1].x - flat[i].x, flat[i + 1].y - flat[i].y) / DEG
  const turns = flat.map((_, i) =>
    i === 0 || i === flat.length - 1 ? 0 : deltaDeg(headingOut(i - 1), headingOut(i)),
  )
  // Segment i runs from waypoint i to i + 1 and takes waypoint i's sun/shade state.
  const stretches: Stretch[] = []
  for (let i = 0; i < waypoints.length - 1; i++) {
    const last = stretches[stretches.length - 1]
    if (last && last.inSun === waypoints[i].inSun) last.endM = distances[i + 1]
    else stretches.push({ startM: distances[i], endM: distances[i + 1], inSun: waypoints[i].inSun })
  }
  return {
    waypoints,
    distances,
    lengthM: distances[distances.length - 1],
    turns,
    stretches,
    origin,
    flat,
  }
}

/** Index of the waypoint that starts the segment containing this progress. */
export function segmentAt(route: Route, progressM: number): number {
  const last = route.distances.length - 2
  let i = 0
  while (i < last && route.distances[i + 1] <= progressM) i++
  return i
}

/** Index of the waypoint closest to this progress. */
export function waypointAt(route: Route, progressM: number): number {
  const i = segmentAt(route, progressM)
  return progressM - route.distances[i] <= route.distances[i + 1] - progressM ? i : i + 1
}

function flatAt(route: Route, progressM: number): Flat {
  const clamped = Math.min(Math.max(progressM, 0), route.lengthM)
  const i = segmentAt(route, clamped)
  const length = route.distances[i + 1] - route.distances[i]
  const t = length > 0 ? (clamped - route.distances[i]) / length : 0
  const a = route.flat[i]
  const b = route.flat[i + 1]
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

export function pointAt(route: Route, progressM: number): LatLng {
  return fromFlat(route.origin, flatAt(route, progressM))
}

/** Compass bearing of the route at this progress. */
export function bearingAt(route: Route, progressM: number): number {
  const i = segmentAt(route, Math.min(Math.max(progressM, 0), route.lengthM))
  const a = route.flat[i]
  const b = route.flat[i + 1]
  return normalizeDeg(Math.atan2(b.x - a.x, b.y - a.y) / DEG)
}

/** The next bend of at least `minTurnDeg` ahead of this progress, or null if there is none. */
export function nextTurn(
  route: Route,
  progressM: number,
  minTurnDeg: number,
): { index: number; aheadM: number; turnDeg: number } | null {
  for (let i = 1; i < route.turns.length - 1; i++) {
    if (route.distances[i] > progressM && Math.abs(route.turns[i]) >= minTurnDeg) {
      return { index: i, aheadM: route.distances[i] - progressM, turnDeg: route.turns[i] }
    }
  }
  return null
}

/** Metres of the route still ahead that are in direct sun (unknown stretches are not counted). */
export function sunMetresAhead(route: Route, progressM: number): number {
  let total = 0
  for (let i = segmentAt(route, progressM); i < route.distances.length - 1; i++) {
    if (route.waypoints[i].inSun === true) {
      total += route.distances[i + 1] - Math.max(route.distances[i], progressM)
    }
  }
  return Math.max(total, 0)
}

/** Closest point to `p` on segments fromSegment..toSegment (inclusive). */
function closestOnSegments(route: Route, p: Flat, fromSegment: number, toSegment: number) {
  let best = { progressM: 0, offsetM: Infinity, flat: route.flat[0] }
  for (let i = fromSegment; i <= toSegment; i++) {
    const a = route.flat[i]
    const b = route.flat[i + 1]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const lengthSq = dx * dx + dy * dy
    const t =
      lengthSq > 0
        ? Math.min(Math.max(((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq, 0), 1)
        : 0
    const flat = { x: a.x + dx * t, y: a.y + dy * t }
    const offsetM = Math.hypot(p.x - flat.x, p.y - flat.y)
    if (offsetM < best.offsetM) {
      best = { progressM: route.distances[i] + Math.sqrt(lengthSq) * t, offsetM, flat }
    }
  }
  return best
}

/**
 * Project a fix onto the route. Pass the previous progress as `nearProgressM` so that where the
 * route doubles back or crosses itself, the snap stays on the stretch being walked.
 */
export function snapToRoute(route: Route, point: LatLng, nearProgressM: number | null): RouteSnap {
  const p = toFlat(route.origin, point)
  const lastSegment = route.flat.length - 2
  let best = null
  if (nearProgressM !== null) {
    best = closestOnSegments(
      route,
      p,
      segmentAt(route, nearProgressM - SNAP_SEARCH_BACK_M),
      segmentAt(route, nearProgressM + SNAP_SEARCH_AHEAD_M),
    )
  }
  if (best === null || best.offsetM > SNAP_MAX_OFFSET_M) {
    best = closestOnSegments(route, p, 0, lastSegment)
  }
  return {
    progressM: best.progressM,
    offsetM: best.offsetM,
    point: fromFlat(route.origin, best.flat),
  }
}
