import { GPS_AVERAGE_WINDOW, GPS_MIN_MOVE_M } from './config.ts'
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
    { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
  )
  return () => navigator.geolocation.clearWatch(watchId)
}

export interface FixSmoother {
  /** Add a raw fix. Returns the smoothed position if it moved enough to matter, else null. */
  push(fix: LatLng): LatLng | null
}

/** Moving average of the last few fixes that ignores small moves, to stop arrows jittering. */
export function createFixSmoother(): FixSmoother {
  const recent: LatLng[] = []
  let emitted: LatLng | null = null
  return {
    push(fix) {
      recent.push({ lat: fix.lat, lng: fix.lng })
      if (recent.length > GPS_AVERAGE_WINDOW) recent.shift()
      const mean: LatLng = {
        lat: recent.reduce((sum, p) => sum + p.lat, 0) / recent.length,
        lng: recent.reduce((sum, p) => sum + p.lng, 0) / recent.length,
      }
      if (emitted && distanceM(emitted, mean) < GPS_MIN_MOVE_M) return null
      emitted = mean
      return mean
    },
  }
}
