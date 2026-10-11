import { useEffect, useState } from "react";
import { CalendarBlank } from "@phosphor-icons/react";
import { api } from "../api/client";
import { atHour, dayLabel, fmt, hourLabel, hourOf, istIso, now } from "../format";
import { bestTimeRequest } from "../session";
import Sheet from "./Sheet";
import Button from "./Button";
import Segmented from "./Segmented";

// The hours with daylight, which is where the sun minutes differ
const FIRST_HOUR = 7;
const LAST_HOUR = 19;
const HOURS = Array.from({ length: LAST_HOUR - FIRST_HOUR + 1 }, (_, i) => FIRST_HOUR + i);
const DAY_MS = 24 * 60 * 60 * 1000;
const TABS = [
  { value: "leave", label: "Leave at" },
  { value: "arrive", label: "Arrive by" },
];

// Leave at / Arrive by (screen 04). Leave at shows each hour's walking sun minutes for the trip.
export default function TimeSheet({ search, onPick, onClose }) {
  const today = now();
  const nowHour = hourOf(istIso(today));
  // After the last hour the sheet plans tomorrow
  const dayIso = istIso(nowHour >= LAST_HOUR ? new Date(today.getTime() + DAY_MS) : today);
  const firstOpenHour = nowHour >= LAST_HOUR ? FIRST_HOUR : Math.max(FIRST_HOUR, nowHour);
  const [mode, setMode] = useState(search.when === "arrive" ? "arrive" : "leave");
  const [hour, setHour] = useState(search.at ? hourOf(search.at) : Math.min(firstOpenHour + 1, LAST_HOUR));
  const [best, setBest] = useState(null);
  const [loading, setLoading] = useState(Boolean(search.destination));
  const [error, setError] = useState("");

  // Home may still be finding where the walker is: the hours are checked once the start is known
  useEffect(() => {
    if (!search.destination || !search.origin) return;
    let current = true;
    setLoading(true);
    setError("");
    api
      .post("/routes/best-time", bestTimeRequest(search.origin, search.destination, dayIso, FIRST_HOUR, LAST_HOUR))
      .then((res) => current && setBest(res.data))
      .catch(() => current && setError("Can't load the sun minutes right now. You can still pick a time."))
      .finally(() => current && setLoading(false));
    return () => {
      current = false;
    };
  }, [search.origin?.lat, search.origin?.lng]);

  const sunAt = (h) => best?.slots.find((slot) => hourOf(slot.departAt) === h)?.sunMinutes;
  const bestHour = best?.best ? hourOf(best.best.departAt) : null;
  const estimate = best?.basis === "TEMPERATURE_ONLY";
  let hint = "SunSkip works out when to leave and shows the sun minutes with the routes.";
  if (mode === "leave") {
    hint = !search.destination
      ? "Pick a destination to see each hour's minutes in sun."
      : loading
        ? "Checking the sun for each hour…"
        : error
          ? error
          : bestHour === null
            ? "Minutes in sun are unknown for this trip."
            : estimate
              ? `There is no shade data for this trip, so minutes in sun are unknown. Coolest hour, an estimate from the temperature: ${hourLabel(bestHour)}.`
              : `Minutes of walking in direct sun for your trip. Least: ${hourLabel(bestHour)}, ${fmt(sunAt(bestHour))} min.`;
  }

  return (
    <Sheet label="Pick a time" className="px-5 pt-1.5 pb-[calc(18px+env(safe-area-inset-bottom))]" onClose={onClose}>
      <Segmented label="Leave at or arrive by" className="mt-3" options={TABS} value={mode} onChange={setMode} />
      <p className="mt-3.5 flex items-center gap-2 font-[650]">
        <CalendarBlank size={20} weight="bold" />
        {dayLabel(dayIso)}
      </p>
      <div className="mt-2.5 grid grid-cols-4 gap-2">
        {HOURS.map((h) => {
          const least = mode === "leave" && h === bestHour;
          const sun = sunAt(h);
          return (
            <button
              key={h}
              type="button"
              disabled={h < firstOpenHour}
              aria-pressed={h === hour}
              onClick={() => setHour(h)}
              className={`press flex min-h-[58px] flex-col items-center justify-center rounded-xl border-2 disabled:opacity-40 ${h === hour ? "border-ink bg-white" : least ? "border-transparent bg-shade-tint" : "border-transparent bg-sunken"}`}
            >
              <b className="text-[15px] font-bold">{hourLabel(h)}</b>
              {mode === "leave" && loading && <i className="shimmer mt-1 block h-2.5 w-12 rounded" />}
              {mode === "leave" && sun != null && <span className={`text-[13px] ${least ? "font-[650] text-shade-text" : "text-muted"}`}>{`${fmt(sun)} min sun`}</span>}
            </button>
          );
        })}
      </div>
      <p className="mt-3 mb-3.5 text-[14px] text-muted">{hint}</p>
      <Button onClick={() => onPick({ when: mode, at: atHour(dayIso, hour) })}>{`${mode === "leave" ? "Leave at" : "Arrive by"} ${hourLabel(hour)}`}</Button>
    </Sheet>
  );
}
