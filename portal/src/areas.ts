// The areas an official can jump to. Each box is under the 25 km² the portal endpoints allow.
export const AREAS = [
  { key: "muj", name: "MUJ and Bus 26 stop", place: "Dehmi Kalan, Jaipur", bbox: "75.555,26.832,75.575,26.850", center: [75.5645, 26.8415], icon: "bus" },
  { key: "mansarovar", name: "Mansarovar Metro", place: "Mansarovar, Jaipur", bbox: "75.738,26.868,75.762,26.888", center: [75.7505, 26.879], icon: "train" },
];

export function areaByKey(key) {
  return AREAS.find((area) => area.key === key) || AREAS[0];
}
