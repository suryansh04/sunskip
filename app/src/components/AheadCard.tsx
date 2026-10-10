import { CloudSlash, Sun, Tree } from "@phosphor-icons/react";

const LOOK = {
  d: { Icon: Tree, style: "bg-shade-tint text-shade-text", now: "Shade", next: "shade" },
  s: { Icon: Sun, style: "bg-sun-tint text-sun-text", now: "Sun", next: "sun" },
  u: { Icon: CloudSlash, style: "bg-sunken text-muted", now: "Shade unknown", next: "shade unknown" },
};

// "Shade for the next 25 m, then sun": sun and shade in words, so colour is never the only signal
export default function AheadCard({ ahead, className = "" }) {
  const look = LOOK[ahead.bit];
  return (
    <div className={`flex items-center gap-2.5 rounded-[14px] px-3.5 py-3 text-[16px] font-[650] ${look.style} ${className}`}>
      <look.Icon size={22} weight="bold" className="flex-none" aria-hidden />
      {`${look.now} for the next ${ahead.meters} m` + (ahead.next ? `, then ${LOOK[ahead.next].next}` : ", to the end of this walk")}
    </div>
  );
}
