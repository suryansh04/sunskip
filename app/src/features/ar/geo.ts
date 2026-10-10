import type { Projection } from 'locar'
import type { LatLng } from './types.ts'

export type { LatLng }

export const EARTH_RADIUS_M = 6371000
const DEG = Math.PI / 180

/** Wrap to 0 <= deg < 360. */
export function normalizeDeg(deg: number): number {
  return ((deg % 360) + 360) % 360
}

/** Signed turn from one heading to another, -180 < delta <= 180 (positive = clockwise). */
export function deltaDeg(fromDeg: number, toDeg: number): number {
  const delta = normalizeDeg(toDeg - fromDeg)
  return delta > 180 ? delta - 360 : delta
}

/** Haversine distance. */
export function distanceM(a: LatLng, b: LatLng): number {
  const dLat = (b.lat - a.lat) * DEG
  const dLng = (b.lng - a.lng) * DEG
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

/** Initial compass bearing from a to b, degrees clockwise from north. */
export function bearingDeg(a: LatLng, b: LatLng): number {
  const dLng = (b.lng - a.lng) * DEG
  const y = Math.sin(dLng) * Math.cos(b.lat * DEG)
  const x =
    Math.cos(a.lat * DEG) * Math.sin(b.lat * DEG) -
    Math.sin(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.cos(dLng)
  return normalizeDeg(Math.atan2(y, x) / DEG)
}

/** The point `distM` metres from `start` along compass bearing `headingDeg`. */
export function destinationPoint(start: LatLng, headingDeg: number, distM: number): LatLng {
  const angular = distM / EARTH_RADIUS_M
  const heading = headingDeg * DEG
  const lat1 = start.lat * DEG
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(heading),
  )
  const lng2 =
    start.lng * DEG +
    Math.atan2(
      Math.sin(heading) * Math.sin(angular) * Math.cos(lat1),
      Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2),
    )
  return { lat: lat2 / DEG, lng: lng2 / DEG }
}

/**
 * Projection for LocAR that keeps world units equal to real metres.
 * LocAR's default (Spherical Mercator) stretches distances by 1/cos(latitude): about 12% at
 * Jaipur, which would put a 50 m arrow 56 m away. This one is flat-earth around the first point
 * it projects, which is accurate to centimetres over a campus-sized area.
 */
export function createLocalProjection(): Projection {
  let cosLat0: number | null = null
  return {
    project(lon, lat) {
      cosLat0 ??= Math.cos(lat * DEG)
      return [EARTH_RADIUS_M * lon * DEG * cosLat0, EARTH_RADIUS_M * lat * DEG]
    },
    unproject([easting, northing]) {
      const lat = northing / EARTH_RADIUS_M / DEG
      cosLat0 ??= Math.cos(lat * DEG)
      return [easting / (EARTH_RADIUS_M * cosLat0) / DEG, lat]
    },
  }
}
