import { ArrowLeft } from "@phosphor-icons/react";
import RoundButton from "./RoundButton";

// Floats over the map: back, a white card saying where you are, and room for one more button
export default function TopBar({ title, subtitle, onBack, children = null }) {
  return (
    <div className="absolute inset-x-0 top-0 z-10 flex items-center gap-2.5 px-4 py-3.5">
      <RoundButton label="Back" onClick={onBack}>
        <ArrowLeft size={20} weight="bold" />
      </RoundButton>
      <div className="flex min-h-[46px] min-w-0 flex-1 flex-col justify-center rounded-xl bg-white px-3.5 py-1 shadow-[0_2px_10px_rgba(40,25,10,.16)]">
        <b className="truncate text-[16px] leading-[1.2] font-[650]">{title}</b>
        <span className="truncate text-[13px] leading-[1.3] text-muted">{subtitle}</span>
      </div>
      {children}
    </div>
  );
}
