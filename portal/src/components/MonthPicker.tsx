import { MONTHS } from "../format";
import Dropdown from "./Dropdown";

export const SUMMER_MONTH = 5; // May, peak summer: the month the portal ranks for by default (api.md §8)
const OPTIONS = MONTHS.map((name, i) => ({ value: i + 1, label: name, note: i + 1 === SUMMER_MONTH ? "Peak summer" : null }));

// The month the shade is worked out for. Every month is ready; May, peak summer, is the default.
export default function MonthPicker({ month, onMonth, disabled = false, className = "" }) {
  return (
    <div className={`flex min-h-[62px] flex-col justify-center px-4 py-2.5 text-[12.5px] text-muted ${className}`}>
      {month === SUMMER_MONTH ? "Month · peak summer" : "Month"}
      <Dropdown value={month} options={OPTIONS} onChange={onMonth} label="Month" disabled={disabled} className="text-[15px] text-ink" />
    </div>
  );
}
