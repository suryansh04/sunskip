// Numbers and words the portal shows. Unknown (null) is always written "unknown", never 0.

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const INR = new Intl.NumberFormat("en-IN");
const LAKH = 100000;

export function inr(value) {
  return value === null || value === undefined ? "unknown" : INR.format(Math.round(value));
}

// ₹1,00,000 reads better as ₹1 lakh on the budget buttons
export function shortInr(value) {
  return value >= LAKH ? `${value / LAKH} lakh` : INR.format(value);
}

export function pct(fraction) {
  return fraction === null || fraction === undefined || Number.isNaN(fraction) ? "unknown" : `${Math.round(fraction * 100)}%`;
}

export function hourLabel(hour) {
  if (hour === 0) return "12 AM";
  if (hour === 12) return "12 PM";
  return hour > 12 ? `${hour - 12} PM` : `${hour} AM`;
}

export function hourTick(hour) {
  if (hour === 0) return "12a";
  if (hour === 12) return "12p";
  return hour > 12 ? `${hour - 12}p` : `${hour}a`;
}

// A stretch's OSM name, else the description built from what's around it (api.md 14)
export function stretchName(stretch) {
  return stretch?.name || stretch?.label || "Unnamed path";
}

export const LABEL_NOTE = "No name in OpenStreetMap: described by the nearest named place or road.";

export function errorMessage(err) {
  return err.response?.data?.error?.message || "Something went wrong";
}

export function reducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
