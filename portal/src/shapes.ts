// 3D shapes for the simulator, drawn with MapLibre fill-extrusion (design.md §12, P5):
// a tree is a trunk and a crown of three stacked discs; a shelter is four posts and a flat roof.

const METERS_PER_DEG = 111320;
const TRUNK = "#7A5A3E";
const POST = "#3A302A";
const LEAF = { normal: ["#5E9447", "#4F7F3A"], proposed: ["#9CC487", "#86B472"], selected: ["#7DB862", "#6AA64F"] };
const ROOF = { normal: "#1E6FD9", proposed: "#8DB8F2", selected: "#2F80ED" };
const ROOF_THICK_M = 0.2;
const POST_INSET_M = 0.3;
const POST_SIZE_M = 0.18;

function offset([lng, lat]: number[], eastM, northM) {
  return [lng + eastM / (METERS_PER_DEG * Math.cos((lat * Math.PI) / 180)), lat + northM / METERS_PER_DEG];
}

export function circle(center, radiusM, sides = 18) {
  const ring = [];
  for (let i = 0; i <= sides; i++) {
    const angle = (i / sides) * 2 * Math.PI;
    ring.push(offset(center, Math.sin(angle) * radiusM, Math.cos(angle) * radiusM));
  }
  return [ring];
}

// A rectangle `lengthM` long in the direction `bearingDeg` (clockwise from north)
export function rect(center, widthM, lengthM, bearingDeg) {
  const turn = (bearingDeg * Math.PI) / 180;
  const along = [Math.sin(turn), Math.cos(turn)];
  const across = [Math.cos(turn), -Math.sin(turn)];
  const corner = (l, w) => offset(center, along[0] * l + across[0] * w, along[1] * l + across[1] * w);
  const l = lengthM / 2;
  const w = widthM / 2;
  return [[corner(l, w), corner(l, -w), corner(-l, -w), corner(-l, w), corner(l, w)]];
}

function block(index, polygon, base, top, color) {
  return { type: "Feature", properties: { index, base, top, color }, geometry: { type: "Polygon", coordinates: polygon } };
}

// `grow` (0–1) raises a new item out of the ground; a recommendation's items nobody has touched yet are lighter
export function itemBlocks(item, index, selected, grow = 1) {
  const center = [item.location.lng, item.location.lat];
  if (item.type === "TREE") {
    const radius = item.crownRadiusM;
    const top = item.heightM * grow;
    const crownBase = Math.max(1.6, item.heightM - 1.7 * radius) * grow;
    const step = (top - crownBase) / 3;
    const [leaf, leafDark] = selected ? LEAF.selected : item.proposed ? LEAF.proposed : LEAF.normal;
    return [
      block(index, circle(center, Math.max(0.25, radius * 0.09), 8), 0, crownBase + step * 0.5, TRUNK),
      block(index, circle(center, radius * 0.78), crownBase, crownBase + step, leafDark),
      block(index, circle(center, radius), crownBase + step, crownBase + 2 * step, leaf),
      block(index, circle(center, radius * 0.62), crownBase + 2 * step, top, leaf),
    ];
  }
  const top = item.heightM * grow;
  const turn = (item.bearingDeg * Math.PI) / 180;
  const posts = [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ].map(([l, w]) => {
    const alongM = l * (item.lengthM / 2 - POST_INSET_M);
    const acrossM = w * (item.widthM / 2 - POST_INSET_M);
    const at = offset(center, Math.sin(turn) * alongM + Math.cos(turn) * acrossM, Math.cos(turn) * alongM - Math.sin(turn) * acrossM);
    return block(index, rect(at, POST_SIZE_M, POST_SIZE_M, 0), 0, top - ROOF_THICK_M, POST);
  });
  return [...posts, block(index, rect(center, item.widthM, item.lengthM, item.bearingDeg), top - ROOF_THICK_M, top, selected ? ROOF.selected : item.proposed ? ROOF.proposed : ROOF.normal)];
}

// The dark patch on the ground under the selected item
export function footprint(item) {
  const center = [item.location.lng, item.location.lat];
  const coordinates = item.type === "TREE" ? circle(center, item.crownRadiusM + 0.6, 28) : rect(center, item.widthM + 1.2, item.lengthM + 1.2, item.bearingDeg);
  return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates } };
}
