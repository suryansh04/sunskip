import type { GpsFailure } from './gps.ts'
import type { CameraFeedState, MotionState } from './stage.ts'

export type GpsStatus = 'waiting' | 'ok' | GpsFailure

export const GPS_MESSAGES: Record<GpsStatus, string | null> = {
  ok: null,
  waiting: 'Finding GPS…',
  denied: 'Location permission denied. Allow location for this site, then reload.',
  unavailable: 'No GPS signal. Move to open sky.',
  timeout: 'No GPS signal. Move to open sky.',
  unsupported: 'This browser has no location support.',
}

export const CAMERA_MESSAGES: Partial<Record<CameraFeedState, string>> = {
  denied: 'Camera permission denied. Allow the camera for this site, then reload.',
  error: 'Camera unavailable. It needs HTTPS and a free camera.',
}

export const MOTION_MESSAGES: Partial<Record<MotionState, string>> = {
  denied: 'Motion sensor permission denied. Arrows cannot follow the phone.',
  unsupported: 'No motion sensors found. Arrows cannot follow the phone.',
}

const COMPASS_POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']

/** 212 -> "SW" */
export function compassPoint(deg: number): string {
  return COMPASS_POINTS[Math.round(deg / 45) % 8]
}

const COMPASS_WORDS = [
  'north',
  'north-east',
  'east',
  'south-east',
  'south',
  'south-west',
  'west',
  'north-west',
]

/** 212 -> "south-west" */
export function compassWord(deg: number): string {
  return COMPASS_WORDS[Math.round(deg / 45) % 8]
}
