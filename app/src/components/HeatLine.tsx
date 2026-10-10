import { CaretRight, ThermometerHot } from "@phosphor-icons/react";

// The feels-like line at the top of a sheet; red only when there is a heat alert. Opens heat details.
export default function HeatLine({ conditions, when, onOpen }) {
  if (conditions?.feelsLikeC == null) return null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`press mx-5 mt-2.5 flex min-h-11 w-[calc(100%-40px)] items-center gap-2 rounded-xl px-3 text-[15px] font-[650] ${conditions.heatAlert ? "bg-alert-tint text-alert" : "bg-sunken text-ink"}`}
    >
      <ThermometerHot size={20} weight="bold" className="flex-none" />
      <span className="flex-1">{`Feels like ${Math.round(conditions.feelsLikeC)}°C ${when}` + (conditions.heatAlert ? " · heat alert" : "")}</span>
      <CaretRight size={18} weight="bold" className="flex-none" />
    </button>
  );
}
