// What the pages pass to each other without shared state: the search being built
// ("search": from, to, when), the walk being looked at ("walk"), and recent places.

const MAX_RECENTS = 3;

// Where the app starts when it can't use your location: the pilot walk's start (PRD §2)
export const MUJ_MAIN_GATE = { lat: 26.8440591, lng: 75.5651573, name: "MUJ main gate" };
export const NEW_SEARCH = { origin: null, destination: null, when: "now", at: null };

export function recall(key) {
  try {
    return JSON.parse(sessionStorage.getItem(key));
  } catch {
    return null;
  }
}

export function remember(key, value) {
  sessionStorage.setItem(key, JSON.stringify(value));
}

export function recentPlaces() {
  try {
    return JSON.parse(localStorage.getItem("recents")) || [];
  } catch {
    return [];
  }
}

export function addRecentPlace(place, searchedAt) {
  const others = recentPlaces().filter((recent) => recent.name !== place.name);
  localStorage.setItem("recents", JSON.stringify([{ ...place, searchedAt }, ...others].slice(0, MAX_RECENTS)));
}

// What /routes/plan and /routes/best-time take as origin or destination: a point when we have one
export function placeInput(place) {
  return place.lat === undefined ? { query: place.query } : { lat: place.lat, lng: place.lng };
}
