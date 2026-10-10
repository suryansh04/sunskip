const BIT_COLOR = { s: "bg-sun", d: "bg-shade", u: "bg-unknown" };
const ENTER_DELAY_MS = 260;
const ENTER_STEP_MS = 9;

// The walk as a row of cells: orange in sun, blue in shade, grey when unknown.
// With stepMs, a new set of bits flips in cell by cell from the start of the walk.
export default function SunStrip({ bits, className = "h-3.5", enter = false, stepMs = 0 }) {
  const count = (bit) => bits.filter((b) => b === bit).length;
  const label = `Sun and shade along the walk: ${count("s")} parts in sun, ${count("d")} in shade, ${count("u")} unknown`;

  return (
    <div role="img" aria-label={label} className={`flex gap-0.5 ${className}`}>
      {bits.map((bit, i) => (
        <i
          key={i}
          className={`flex-1 rounded-sm ${BIT_COLOR[bit]} ${enter ? "animate-fill" : ""}`}
          style={{ transition: `background-color 0s linear ${i * stepMs}ms`, animationDelay: `${ENTER_DELAY_MS + i * ENTER_STEP_MS}ms` }}
        />
      ))}
    </div>
  );
}
