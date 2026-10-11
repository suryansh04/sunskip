// What the simulator can plant or build, and what it costs. All costs are estimates from Indian public
// figures (2015–2024); the sources are listed in design.md §12 and on the simulator's cost note.

// Every tree: pit and planting ₹200 and three years of care ₹400 (IISc ETR 90), a municipal tree guard ₹1,280
const TREE_UPKEEP_INR = 200 + 400 + 1280;
// 8–10 ft saplings in nursery listings: neem ₹120, gulmohar ₹349, banyan ₹459; ₹350 where a species wasn't listed
const TYPICAL_SAPLING_INR = 350;

// Young: what the recommendations assume (api/app/config.py tree_height_m, tree_crown_radius_m).
// Grown: heights from Indian planting guides; the crown follows the Indian Roads Congress spacing of
// 12 m between shade trees, so neighbouring crowns just meet (6 m radius). No source gives crown widths.
export const YOUNG_TREE = { heightM: 6, crownRadiusM: 3 };
const GROWN_CROWN_M = 6;

export const TREES = [
  { key: "neem", name: "Neem", heightM: 15, saplingInr: 120, note: "13–20 m tall, hardy in dry soil" },
  { key: "arjun", name: "Arjun", heightM: 20, saplingInr: TYPICAL_SAPLING_INR, note: "20–25 m tall, a common roadside tree" },
  { key: "siris", name: "Siris", heightM: 20, saplingInr: TYPICAL_SAPLING_INR, note: "20–25 m tall, spreads fast, takes drought" },
  { key: "peepal", name: "Peepal", heightM: 25, saplingInr: TYPICAL_SAPLING_INR, note: "up to about 30 m, needs room" },
].map((tree) => ({ ...tree, crownRadiusM: GROWN_CROWN_M, costInr: tree.saplingInr + TREE_UPKEEP_INR }));

// Bus shelters built by Indian cities. Sizes are SunSkip's default 3 × 6 m, except the concrete one (150 sq ft).
export const SHELTERS = [
  { key: "basic", name: "Basic shelter", costInr: 250000, widthM: 3, lengthM: 6, note: "₹1–2.5 lakh in Hyderabad and Mysuru" },
  { key: "concrete", name: "Concrete shelter", costInr: 350000, widthM: 2.5, lengthM: 5.5, note: "₹3.5 lakh for 150 sq ft in Chandigarh" },
  { key: "steel", name: "Steel shelter", costInr: 750000, widthM: 3, lengthM: 6, note: "₹6.5–8 lakh in Delhi, Indore and Coimbatore" },
  { key: "smart", name: "Smart shelter", costInr: 2200000, widthM: 3, lengthM: 6, note: "₹20–25 lakh in Delhi and Mangaluru" },
];

export const DEFAULT_TREE = "neem"; // the tree the recommendations price (config.py tree_cost_inr)
export const DEFAULT_SHELTER = "steel"; // the one the recommendations price (config.py shelter_cost_inr)

export function itemCost(item) {
  if (item.type === "TREE") return (TREES.find((tree) => tree.key === item.kind) || TREES[0]).costInr;
  return (SHELTERS.find((shelter) => shelter.key === item.kind) || SHELTERS[2]).costInr;
}

export const COST_SOURCES =
  "Costs are estimates from Indian public figures, 2015–2024: IISc avenue-tree study (planting, care), Bathinda municipal tree-guard rate, nursery listings (saplings), and city bus-shelter costs reported in Hyderabad, Mysuru, Chandigarh, Delhi, Indore, Coimbatore and Mangaluru. Real tenders vary by city and year.";
