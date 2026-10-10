// How the app writes numbers, times and labels (design.md §9). All times are IST.

const LABEL_TEXT = { RECOMMENDED: "Recommended", FASTEST: "Fastest", CHEAPEST: "Cheapest", COOLEST: "Coolest" };
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const MOCK_NOW = "2026-05-15T13:00:00+05:30";

// The demo runs in May (PRD §9): VITE_DEMO_NOW sets the app's "now". The mock data is for 15 May, 1 PM.
const demoNow = import.meta.env.VITE_DEMO_NOW || (import.meta.env.VITE_USE_MOCKS === "true" ? MOCK_NOW : "");

export function now() {
  return demoNow ? new Date(demoNow) : new Date();
}

// Date -> "2026-05-15T13:00:00+05:30"
export function istIso(date) {
  return new Date(date.getTime() + IST_OFFSET_MS).toISOString().slice(0, 19) + "+05:30";
}

export function hourOf(iso) {
  return Number(iso.slice(11, 13));
}

// The same day at a whole hour: ("2026-05-15T13:20:00+05:30", 18) -> "2026-05-15T18:00:00+05:30"
export function atHour(iso, hour) {
  return `${iso.slice(0, 11)}${String(hour).padStart(2, "0")}:00:00+05:30`;
}

// null is "unknown", never 0. One decimal, rounded half up (11.25 -> 11.3).
export function fmt(value) {
  return value === null || value === undefined ? "unknown" : String(Math.round(value * 10) / 10);
}

// 17 -> "5 PM"
export function hourLabel(hour) {
  return `${hour % 12 || 12} ${hour >= 12 ? "PM" : "AM"}`;
}

// "2026-05-15T13:22:29+05:30" -> "1:22 PM"
export function timeOf(iso) {
  const hour = hourOf(iso);
  return `${hour % 12 || 12}:${iso.slice(14, 16)} ${hour >= 12 ? "PM" : "AM"}`;
}

// Whole hours read as "1 PM", other times as "1:22 PM"
export function shortTime(iso) {
  return iso.slice(14, 16) === "00" ? hourLabel(hourOf(iso)) : timeOf(iso);
}

// "2026-05-15..." -> "Fri 15 May"
export function dayLabel(iso) {
  const day = new Date(iso.slice(0, 10) + "T00:00:00Z");
  return `${WEEKDAYS[day.getUTCDay()]} ${day.getUTCDate()} ${MONTHS[day.getUTCMonth()]}`;
}

// 7964 -> "2 h 13 min"
export function duration(seconds) {
  const minutes = Math.round(seconds / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`;
}

export function labelsText(labels) {
  return labels.map((label) => LABEL_TEXT[label]).join(" · ");
}

// "₹65 est." on cards, "₹65, estimated" in full sentences, "fare unknown" for null
export function fareText(option, estimateWord) {
  if (option.fareInr === null) return "fare unknown";
  return `₹${option.fareInr}` + (option.warnings.includes("FARE_ESTIMATED") ? estimateWord : "");
}

// "From your location · MUJ main gate", "From the pinned start"
export function fromLine(origin) {
  if (!origin) return "Finding your location…";
  return origin.mine ? ["From your location", origin.name].filter(Boolean).join(" · ") : `From ${origin.name}`;
}

export function errorMessage(err) {
  return err.response?.data?.error?.message || "Something went wrong";
}
