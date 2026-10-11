import { useState } from "react";
import { sunColor } from "../bands";
import { MONTHS, hourLabel, hourTick, pct } from "../format";

const RANKED_MONTH = 4; // May, row index
const RANKED_FROM = 10;
const RANKED_TO = 16;
const NIGHT = "repeating-linear-gradient(135deg,#EDE7DF 0 3px,#F8F5F1 3px 6px)";

// 12 months × 24 hours of sun on the stretch (api.md 17); null = sun below 5°. May 10 AM – 4 PM is outlined.
export default function SunGrid({ sunByMonthHour }) {
  const [reading, setReading] = useState("");
  const ranked = (month, hour) => month === RANKED_MONTH && hour >= RANKED_FROM && hour <= RANKED_TO;

  return (
    <>
      <div className="mt-4 grid grid-cols-[44px_repeat(24,1fr)] gap-0.5 tabular-nums" onMouseLeave={() => setReading("")}>
        <span />
        {Array.from({ length: 24 }, (_, hour) => (
          <span key={hour} className={`pb-1 text-center text-[11px] font-semibold ${hour >= RANKED_FROM && hour <= RANKED_TO ? "font-extrabold text-ink" : "text-muted"}`}>
            {hour % 3 === 0 ? hourTick(hour) : ""}
          </span>
        ))}
        {sunByMonthHour.map((row, month) => (
          <div key={month} className="contents">
            <span className={`flex items-center text-[12.5px] font-bold ${month === RANKED_MONTH ? "text-ink" : "text-muted"}`}>{MONTHS[month].slice(0, 3)}</span>
            {row.map((sun, hour) => (
              <span
                key={hour}
                onMouseEnter={() => setReading(`${MONTHS[month]}, ${hourLabel(hour)}: ${sun === null ? "sun below 5° or no data" : `${pct(sun)} in sun`}`)}
                className={`print-color relative h-7 hover:z-[1] hover:outline-2 hover:outline-ink print:h-[19px] ${ranked(month, hour) ? "shadow-[inset_0_0_0_2px_var(--color-ink)]" : ""}`}
                style={{ background: sun === null ? NIGHT : sunColor(sun) }}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="mt-3.5 flex flex-wrap items-center gap-4.5 text-[12.5px] text-muted">
        <span className="flex items-center gap-2">
          All shade <i className="print-color h-2.5 w-[150px] bg-[linear-gradient(90deg,#2F80ED,#C9DDF7_35%,#FBE3CC_62%,#F2994A_85%,#D9731F)]" /> All sun
        </span>
        <span className="flex items-center gap-2">
          <i className="print-color h-3 w-5.5" style={{ background: NIGHT }} />
          Sun below 5°
        </span>
        <span className="flex items-center gap-2">
          <i className="h-3 w-4 shadow-[inset_0_0_0_2px_var(--color-ink)]" />
          Ranked hours
        </span>
        <span className="ml-auto min-h-5 text-[14px] font-bold text-ink print:hidden">{reading}</span>
      </div>
    </>
  );
}
