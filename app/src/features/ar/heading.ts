import {
  HEADING_DEADBAND_DEG,
  HEADING_FLAT_FROM,
  HEADING_FLAT_FULL,
  HEADING_MAX_TURN_DEG_PER_S,
  HEADING_SETTLE_DEG,
  HEADING_SMOOTHING_S,
} from './config.ts'
import { deltaDeg, normalizeDeg } from './geo.ts'

// Compass heading of the phone, and a steady version of it to show. Plain maths with no three.js,
// so the arrow screen outside this folder can use it without loading the AR chunk.

const DEG = Math.PI / 180

/** A direction over the ground: its parts pointing east, north and up. */
export interface Direction {
  east: number
  north: number
  up: number
}

function smoothstep(value: number, from: number, to: number): number {
  const t = Math.min(Math.max((value - from) / (to - from), 0), 1)
  return t * t * (3 - 2 * t)
}

/** The part of a direction that lies along the ground, one unit long (zero if it points straight up). */
function alongGround(east: number, north: number): { east: number; north: number } {
  const length = Math.hypot(east, north)
  return length < 1e-6 ? { east: 0, north: 0 } : { east: east / length, north: north / length }
}

/**
 * Heading in degrees clockwise from north, from where the camera looks and where the top of the
 * screen points. It is where the camera looks, laid on the ground, so tilting the phone up or down
 * or rolling it doesn't change it. Lying nearly flat the camera looks at the ground and has no
 * heading of its own; there the top edge takes over, blended in so nothing jumps on the way.
 */
export function headingOf(forward: Direction, top: Direction): number {
  const flatness = smoothstep(Math.abs(forward.up), HEADING_FLAT_FROM, HEADING_FLAT_FULL)
  // Looking down, the top edge points ahead; looking up, it points back.
  const ahead = forward.up > 0 ? -1 : 1
  const look = alongGround(forward.east, forward.north)
  const edge = alongGround(ahead * top.east, ahead * top.north)
  const east = look.east * (1 - flatness) + edge.east * flatness
  const north = look.north * (1 - flatness) + edge.north * flatness
  return normalizeDeg(Math.atan2(east, north) / DEG)
}

/**
 * Heading from a deviceorientation event's alpha, beta and gamma (they must be absolute, as in
 * deviceorientationabsolute). All three are needed: alpha alone is only the heading while the phone
 * lies flat. `screenAngleDeg` is screen.orientation.angle.
 */
export function headingFromOrientation(
  alphaDeg: number,
  betaDeg: number,
  gammaDeg: number,
  screenAngleDeg = 0,
): number {
  const [sinA, cosA] = [Math.sin(alphaDeg * DEG), Math.cos(alphaDeg * DEG)]
  const [sinB, cosB] = [Math.sin(betaDeg * DEG), Math.cos(betaDeg * DEG)]
  const [sinG, cosG] = [Math.sin(gammaDeg * DEG), Math.cos(gammaDeg * DEG)]
  // The columns of the W3C rotation matrix Rz(alpha) Rx(beta) Ry(gamma): where the phone's right
  // side, top edge and screen face point, as east / north / up.
  const right = { east: cosA * cosG - sinA * sinB * sinG, north: cosG * sinA + cosA * sinB * sinG, up: -cosB * sinG }
  const topEdge = { east: -cosB * sinA, north: cosA * cosB, up: sinB }
  const screen = { east: cosG * sinA * sinB + cosA * sinG, north: sinA * sinG - cosA * cosG * sinB, up: cosB * cosG }
  // The rear camera looks out of the back. In landscape the top of the picture is a side of the phone.
  const forward = { east: -screen.east, north: -screen.north, up: -screen.up }
  const [sinS, cosS] = [Math.sin(screenAngleDeg * DEG), Math.cos(screenAngleDeg * DEG)]
  const top = {
    east: topEdge.east * cosS + right.east * sinS,
    north: topEdge.north * cosS + right.north * sinS,
    up: topEdge.up * cosS + right.up * sinS,
  }
  return headingOf(forward, top)
}

export interface HeadingSmoother {
  /** Feed the latest heading and the time since the last one; returns the heading to show. */
  update(headingDeg: number, dtSeconds: number): number
}

/**
 * Steadies a compass heading for display. A running average (taken as a direction, so it is right
 * across north), then a deadband so small wobbles don't move anything, then a cap on how fast the
 * shown heading may turn.
 */
export function createHeadingSmoother(): HeadingSmoother {
  let east = 0
  let north = 0
  let shownDeg: number | null = null
  let turning = false
  return {
    update(headingDeg, dtSeconds) {
      const nowEast = Math.sin(headingDeg * DEG)
      const nowNorth = Math.cos(headingDeg * DEG)
      if (shownDeg === null) {
        east = nowEast
        north = nowNorth
        shownDeg = normalizeDeg(headingDeg)
        return shownDeg
      }
      const blend = 1 - Math.exp(-dtSeconds / HEADING_SMOOTHING_S)
      east += (nowEast - east) * blend
      north += (nowNorth - north) * blend
      const offDeg = deltaDeg(shownDeg, Math.atan2(east, north) / DEG)
      if (Math.abs(offDeg) > HEADING_DEADBAND_DEG) turning = true
      else if (Math.abs(offDeg) < HEADING_SETTLE_DEG) turning = false
      if (turning) {
        const maxStep = HEADING_MAX_TURN_DEG_PER_S * dtSeconds
        shownDeg = normalizeDeg(shownDeg + Math.min(Math.max(offDeg, -maxStep), maxStep))
      }
      return shownDeg
    },
  }
}
