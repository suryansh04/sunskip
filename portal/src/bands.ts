// Pain bands (design.md §12): the line colour on the map, and a text colour that passes 4.5:1 on white
export const BANDS = [
  { key: "severe", name: "Severe", min: 70, color: "#B91C1C", text: "#B91C1C", legend: "Severe 70+", inkText: false },
  { key: "high", name: "High", min: 40, color: "#E8590C", text: "#C2410C", legend: "High 40–69", inkText: false },
  { key: "moderate", name: "Moderate", min: 20, color: "#F2994A", text: "#9A4D0E", legend: "Moderate 20–39", inkText: true },
  { key: "low", name: "Low", min: 0, color: "#E9B98B", text: "#6B5F55", legend: "Low", inkText: true },
  { key: "unknown", name: "Unknown", min: null, color: "#D8D1C7", text: "#6B5F55", legend: "Unknown", inkText: true },
];

export function bandOf(pain) {
  if (pain === null || pain === undefined) return BANDS[BANDS.length - 1];
  return BANDS.find((band) => band.min !== null && pain >= band.min);
}

// The same bands as MapLibre expressions on a feature's `pain`
export const PAIN_COLOR = ["case", ["==", ["get", "pain"], null], "#D8D1C7", ["step", ["get", "pain"], "#E9B98B", 20, "#F2994A", 40, "#E8590C", 70, "#B91C1C"]];
export const PAIN_WIDTH = ["case", ["==", ["get", "pain"], null], 2, ["step", ["get", "pain"], 2.5, 20, 3.5, 40, 5, 70, 7]];

// Evidence grid: 0 = all shade (blue) … 1 = all sun (deep orange), through a pale middle
const SUN_RAMP = [
  [0, [47, 128, 237]],
  [0.35, [201, 221, 247]],
  [0.62, [251, 227, 204]],
  [0.85, [242, 153, 74]],
  [1, [217, 115, 31]],
];

export function sunColor(fraction) {
  let i = 0;
  while (i < SUN_RAMP.length - 2 && fraction > SUN_RAMP[i + 1][0]) i++;
  const [fromAt, from]: any = SUN_RAMP[i];
  const [toAt, to]: any = SUN_RAMP[i + 1];
  const t = Math.min(1, Math.max(0, (fraction - fromAt) / (toAt - fromAt)));
  return `rgb(${from.map((channel, k) => Math.round(channel + (to[k] - channel) * t)).join(",")})`;
}
