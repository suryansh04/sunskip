import { flatCoords } from "../map";

const WIDTH = 560;
const HEIGHT = 320;
const METERS_PER_DEG = 111320;
const SCALE_BAR_M = 50;
const ROOM = 1.5; // the drawing shows the stretch with half its size again around it

// A clean line drawing of the stretch (orange) and the paths around it (grey), with a 50 m bar
// and a north arrow, made to print. `paths` is a /shade/segments answer.
export default function StretchDrawing({ stretchId, paths }) {
  const mine = paths.features.filter((feature) => feature.properties.stretchId === stretchId);
  if (!mine.length) return null;
  const points = mine.flatMap((feature) => flatCoords(feature.geometry));
  const lngs = points.map((point) => point[0]);
  const lats = points.map((point) => point[1]);
  const midLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const kx = METERS_PER_DEG * Math.cos((midLat * Math.PI) / 180);
  const spanM = Math.max((Math.max(...lngs) - Math.min(...lngs)) * kx, (Math.max(...lats) - Math.min(...lats)) * METERS_PER_DEG) * ROOM + 120;
  const scale = Math.min(WIDTH, HEIGHT) / spanM;
  const xy = ([lng, lat]) => [WIDTH / 2 + (lng - midLng) * kx * scale, HEIGHT / 2 - (lat - midLat) * METERS_PER_DEG * scale];
  const line = (feature) => `M${flatCoords(feature.geometry).map((point) => xy(point).map((n) => n.toFixed(1)).join(",")).join("L")}`;
  const others = paths.features.filter((feature) => feature.properties.stretchId !== stretchId);
  const bar = SCALE_BAR_M * scale;

  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Drawing of the stretch and the paths around it" className="print-color mt-3.5 block h-auto w-full bg-hover">
      {others.map((feature) => (
        <path key={feature.properties.id} d={line(feature)} fill="none" stroke="#D2C9BE" strokeWidth="2.5" />
      ))}
      {mine.map((feature) => (
        <path key={feature.properties.id} d={line(feature)} fill="none" stroke="#E8590C" strokeWidth="7" strokeLinejoin="miter" />
      ))}
      <g transform={`translate(18,${HEIGHT - 22})`}>
        <rect width={bar} height="6" fill="#141110" />
        <text x={bar + 8} y="7" fontSize="12" fontWeight="700" fill="#141110">
          {SCALE_BAR_M} m
        </text>
      </g>
      <g transform={`translate(${WIDTH - 26},26)`}>
        <path d="M0,-12 L6,6 L0,2 L-6,6Z" fill="#141110" />
        <text y="20" textAnchor="middle" fontSize="11" fontWeight="800" fill="#141110">
          N
        </text>
      </g>
    </svg>
  );
}
