import { fmt, hourLabel, hourOf } from "../format";

const BAR_MAX_PX = 66;
const BAR_MIN_PX = 4;

// "Leave later" bars: one per start hour, minutes in direct sun. The blue highlight slides to the picked hour.
export default function HourBars({ slots, hour, onPick }) {
  const tallest = Math.max(...slots.map((slot) => slot.sunMinutes), 0.1);
  const picked = Math.max(0, slots.findIndex((slot) => hourOf(slot.departAt) === hour));

  return (
    <div className="relative mt-2 grid h-32 items-end" style={{ gridTemplateColumns: `repeat(${slots.length}, 1fr)` }}>
      <span
        className="absolute inset-y-0 left-0 rounded-xl bg-shade-tint transition-transform duration-[320ms] ease-soft"
        style={{ width: `${100 / slots.length}%`, transform: `translateX(${picked * 100}%)` }}
      />
      {slots.map((slot, i) => {
        const on = i === picked;
        const slotHour = hourOf(slot.departAt);
        return (
          <button
            key={slot.departAt}
            type="button"
            aria-pressed={on}
            aria-label={`${hourLabel(slotHour)}: ${fmt(slot.sunMinutes)} minutes in sun`}
            onClick={() => onPick(slotHour)}
            className="relative z-[1] flex h-full flex-col items-center justify-end gap-1.5 pt-2 pb-1.5"
          >
            <span className={`text-[14px] ${on ? "font-bold text-shade-text" : "font-[650]"}`}>{fmt(slot.sunMinutes)}</span>
            <i className={`w-5 rounded-[5px] ${on ? "bg-shade" : "bg-sun"}`} style={{ height: Math.max(BAR_MIN_PX, Math.round((BAR_MAX_PX * slot.sunMinutes) / tallest)) }} />
            <span className={`text-[13px] whitespace-nowrap ${on ? "font-bold text-shade-text" : "text-muted"}`}>{hourLabel(slotHour)}</span>
          </button>
        );
      })}
    </div>
  );
}
