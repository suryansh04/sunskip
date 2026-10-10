import { GPS_JUMP_SIGMAS, GPS_JUMPS_TO_ACCEPT, GPS_MIN_MOVE_M, GPS_WALK_NOISE_MPS, GPS_TIMEOUT_MS, GPS_WORST_ACCURACY_M } from './config.ts'
import { distanceM } from './geo.ts'
import type { LatLng } from './geo.ts'

export interface GpsFix extends LatLng {
  accuracyM: number
  timestamp: number
}

export type GpsFailure = 'denied' | 'unavailable' | 'timeout' | 'unsupported'

/**
 * Our own geolocation watch. LocAR's built-in one moves the camera on every raw fix, so we watch
 * here, smooth, and feed the result to LocAR ourselves. Returns a function that stops the watch.
 */
export function watchGps(
  onFix: (fix: GpsFix) => void,
  onFailure: (failure: GpsFailure) => void,
): () => void {
  if (!('geolocation' in navigator)) {
    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled) onFailure('unsupported')
    })
    return () => {
      cancelled = true
    }
  }

  const watchId = navigator.geolocation.watchPosition(
    (position) => {
      onFix({
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracyM: position.coords.accuracy,
        timestamp: position.timestamp,
      })
    },
    (error) => {
      if (error.code === error.PERMISSION_DENIED) onFailure('denied')
      else if (error.code === error.TIMEOUT) onFailure('timeout')
      else onFailure('unavailable')
    },
    { enableHighAccuracy: true, maximumAge: 0, timeout: GPS_TIMEOUT_MS },
  )
  return () => navigator.geolocation.clearWatch(watchId)
}

export interface FixSmoother {
  /** Add a raw fix. Returns the filtered fix if it moved or its accuracy changed enough to matter, else null. */
  push(fix: GpsFix): GpsFix | null
}

/**
 * A small Kalman filter over the fixes. Each fix pulls the position in by how sure it is compared
 * with the position we already have, which grows less sure the longer the walker has been moving.
 * A fix far outside both is a jump (a reflection off a building) and is dropped.
 */
export function createFixSmoother(): FixSmoother {
  let estimate: GpsFix | null = null
  let emitted: GpsFix | null = null
  let jumps = 0
  return {
    push(fix) {
      if (estimate && fix.timestamp <= estimate.timestamp) return null
      if (estimate && fix.accuracyM > GPS_WORST_ACCURACY_M && estimate.accuracyM <= GPS_WORST_ACCURACY_M) return null
      if (!estimate) {
        estimate = fix
      } else {
        const seconds = (fix.timestamp - estimate.timestamp) / 1000
        const spreadSq = (estimate.accuracyM + seconds * GPS_WALK_NOISE_MPS) ** 2
        const jumped = distanceM(estimate, fix) > GPS_JUMP_SIGMAS * Math.sqrt(spreadSq + fix.accuracyM ** 2)
        jumps = jumped ? jumps + 1 : 0
        if (jumped && jumps < GPS_JUMPS_TO_ACCEPT) return null
        const gain = jumped ? 1 : spreadSq / (spreadSq + fix.accuracyM ** 2)
        estimate = {
          lat: estimate.lat + gain * (fix.lat - estimate.lat),
          lng: estimate.lng + gain * (fix.lng - estimate.lng),
          accuracyM: jumped ? fix.accuracyM : Math.sqrt((1 - gain) * spreadSq),
          timestamp: fix.timestamp,
        }
        if (jumped) jumps = 0
      }
      const moved = !emitted || distanceM(emitted, estimate) >= GPS_MIN_MOVE_M
      if (!moved && Math.abs(emitted.accuracyM - estimate.accuracyM) < GPS_MIN_MOVE_M) return null
      emitted = estimate
      return estimate
    },
  }
}
