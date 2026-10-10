import { fmt } from "../format";

// Another way to do the same walk (e-rickshaw, shadier path) with its minutes in sun on the right
export default function SwapRow({ icon, title, detail, tags = "", sunMinutes, shade = false }) {
  return (
    <div className="flex min-h-16 items-center gap-3 border-line py-2.5 not-first:border-t">
      <span className={`grid size-[42px] flex-none place-items-center rounded-xl ${shade ? "bg-shade-tint text-shade-text" : "bg-sunken"}`}>{icon}</span>
      <div className="min-w-0 flex-1">
        <b className="block text-[16px] leading-[1.3] font-[650]">{title}</b>
        <span className="text-[14px] text-muted">{detail}</span>
        {tags && <div className="mt-0.5 text-[13px] font-[650] text-shade-text">{tags}</div>}
      </div>
      <div className="text-right">
        {sunMinutes === null ? <b className="block text-[15px] font-[650] text-muted">unknown</b> : <b className="wide block text-[22px] leading-none font-[720]">{fmt(sunMinutes)}</b>}
        <span className="text-[13px] text-muted">min in sun</span>
      </div>
    </div>
  );
}
