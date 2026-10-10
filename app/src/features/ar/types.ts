// The data the AR view walks: one waypoint list from
// GET /routes/{tripId}/options/{optionId}/waypoints. The shape is fixed by the API contract.
// Defined here, inside the feature, so the feature folder can be used on its own;
// src/api/types.ts re-exports these.

export interface LatLng {
  lat: number
  lng: number
}

export interface Waypoint {
  index: number
  location: LatLng
  distanceFromStartM: number
  legIndex: number
  /** Compass bearing to walk from this waypoint, degrees clockwise from north. */
  bearingDeg: number
  /** null = shade unknown. */
  inSun: boolean | null
  /** Short instruction for the walker. Empty, null or missing all mean "nothing to say". */
  cue?: string | null
}
