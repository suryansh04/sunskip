import { Clock } from "@phosphor-icons/react";
import { fmt } from "../format";

// Waiting sun is always shown apart from walking sun, never added to it (design.md §7)
export default function WaitLine({ exposure, className = "" }) {
  if (!(exposure.waitSunMinutes > 0)) return null;
  return (
    <span className={`flex items-center gap-1.5 text-[14px] font-semibold text-sun-text ${className}`}>
      <Clock size={17} weight="bold" className="flex-none" />
      {`+ ${fmt(exposure.waitSunMinutes)} min waiting at stops in the sun`}
    </span>
  );
}
