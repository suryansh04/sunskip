import { duration, fareText, fmt, labelsText } from "../format";
import ModeChain from "./ModeChain";
import WaitLine from "./WaitLine";

const RISE_STEP_MS = 45;

// One route option (design.md §7). `top` is the recommended one; `waiting` is a route whose
// shade data is still being prepared, which can't be opened yet.
export default function RouteCard({ option, index, top, waiting, onOpen }) {
  const sun = option.exposure.sunMinutes;
  const unknownWhy = option.warnings.includes("SHADE_PREPARING") ? "walking sun · preparing" : "walking sun · no shade data";

  return (
    <button
      type="button"
      disabled={waiting}
      onClick={onOpen}
      style={{ animationDelay: `${index * RISE_STEP_MS}ms` }}
      className={`mx-4 mt-2.5 block w-[calc(100%-32px)] animate-rise rounded-2xl px-4 py-3.5 transition-transform duration-[250ms] ease-soft active:scale-[.98] active:duration-[80ms] ${top ? "border-2 border-ink" : "border border-line"} ${waiting ? "bg-[#FCFAF7]" : "bg-white"}`}
    >
      {option.labels.length > 0 && <span className="mb-1.5 block text-[13px] font-bold text-shade-text">{labelsText(option.labels)}</span>}
      <ModeChain legs={option.legs} />
      <span className="mt-3 flex items-end justify-between gap-3">
        <span>
          {sun === null ? <b className="block text-[22px] leading-[1.6] font-[650] text-muted">unknown</b> : <b className="wide block text-[34px] leading-none font-[760]">{fmt(sun)}</b>}
          <span className="mt-0.5 block text-[13px] text-muted">{sun === null ? unknownWhy : "min walking in sun"}</span>
        </span>
        <span className="text-right">
          <b className="block text-[18px] font-bold">{duration(option.durationSeconds)}</b>
          <span className="mt-0.5 block text-[13px] text-muted">{`${fareText(option, " est.")} · ${option.exposure.walkMeters} m on foot`}</span>
        </span>
      </span>
      <WaitLine exposure={option.exposure} className="mt-2.5" />
    </button>
  );
}
