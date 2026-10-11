import { useEffect, useState } from "react";
import { Info } from "@phosphor-icons/react";
import { hourLabel, inr, reducedMotion } from "../format";

const BAR_TOP_PCT = 60; // the bars are drawn against 60% shade, so small gains still show
const COUNT_MS = 700;

function barHeight(shadePct) {
  return `${Math.min(100, Math.max(2, (shadePct / BAR_TOP_PCT) * 100))}%`;
}

// After Run: sun-minutes saved (counting up), shade before vs after each hour, and the approximation note
export default function SimResult({ result, grown }) {
  const [counted, setCounted] = useState(0);
  const target = result.sunMinutesSavedPerDay;

  // The number counts up once the bars start to grow
  useEffect(() => {
    if (!grown || target === null || reducedMotion()) return setCounted(grown ? target || 0 : 0);
    const started = performance.now();
    let frame = 0;
    const step = (now) => {
      const t = Math.min(1, (now - started) / COUNT_MS);
      setCounted(Math.round(target * (1 - Math.pow(1 - t, 3))));
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [grown, target]);
  return (
    <div className="grid animate-enter gap-4 px-6.5 py-5">
      <div className="flex items-end gap-3.5">
        <span className="num text-[96px] leading-[0.82]">{result.sunMinutesSavedPerDay === null ? "unknown" : inr(counted)}</span>
        <span className="max-w-[22ch] pb-1 text-[14px] leading-snug text-muted">sun-minutes saved a day on all paths within 60 m</span>
      </div>
      <div>
        <div className="flex gap-4 text-[12.5px] text-muted">
          <span className="flex items-center gap-1.5">
            <i className="size-[11px] bg-[#CFC6BD]" />
            Shade now
          </span>
          <span className="flex items-center gap-1.5">
            <i className="size-[11px] bg-shade" />
            With this plan
          </span>
        </div>
        <div className="mt-2 grid h-40 items-end gap-2.5 border-b-2 border-ink" style={{ gridTemplateColumns: `repeat(${result.byHour.length}, 1fr)` }}>
          {result.byHour.map((hour) => {
            const gain = Math.round(hour.shadePctAfter - hour.shadePctBefore);
            return (
              <div key={hour.hour} className="flex h-full flex-col items-center justify-end gap-1">
                <em className="num text-[15px] text-shade-text not-italic">{gain > 0 ? `+${gain}` : ""}</em>
                <div className="flex h-full w-full items-end justify-center gap-[3px]">
                  <i className="w-3.5 bg-[#CFC6BD] transition-[height] duration-700" style={{ height: barHeight(hour.shadePctBefore) }} />
                  <i className="w-3.5 bg-shade transition-[height] duration-700" style={{ height: barHeight(grown ? hour.shadePctAfter : hour.shadePctBefore) }} />
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-1.5 grid gap-2.5 text-center text-[11.5px] text-muted" style={{ gridTemplateColumns: `repeat(${result.byHour.length}, 1fr)` }}>
          {result.byHour.map((hour) => (
            <span key={hour.hour}>{hourLabel(hour.hour)}</span>
          ))}
        </div>
        <p className="mt-2 text-[12.5px] text-muted">% of paths within 60 m of the items that are in shade, each hour</p>
      </div>
      <p className="flex gap-2 text-[12.5px] leading-normal text-muted">
        <Info size={16} weight="bold" className="mt-px flex-none" />
        {result.segments.length} path pieces get more shade (blue on the map). An approximation: it ignores trunks, gaps in the leaves and how long trees take to grow.
      </p>
    </div>
  );
}
