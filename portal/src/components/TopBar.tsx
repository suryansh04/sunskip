import { useState } from "react";
import { Bus, CaretDown, ChartBar, Cube, Fire, SignOut, TrainSimple, Tree } from "@phosphor-icons/react";
import { AREAS } from "../areas";
import { loginNeeded, logout, signedInEmail } from "../auth";

const TABS = [
  { key: "pain", label: "Heat pain", icon: Fire },
  { key: "recs", label: "Trees + shelters", icon: Tree },
  { key: "sim", label: "Simulator", icon: Cube },
  { key: "stats", label: "Usage", icon: ChartBar },
];
const AREA_ICON = { bus: Bus, train: TrainSimple };

// The black bar (design.md §12): logo, the four sections as full-height tabs, the area picker, the account
export default function TopBar({ tab, onTab, area, onArea }) {
  const [open, setOpen] = useState(false);
  const email = signedInEmail();

  function pick(key) {
    setOpen(false);
    onArea(key);
  }

  return (
    <header className="relative z-10 flex items-stretch bg-ink text-white">
      <div className="cond flex items-center gap-2.5 border-r border-barline pr-6.5 pl-6 text-[23px]">
        <img src="/favicon.svg" alt="" className="size-6" />
        SunSkip
      </div>
      <nav aria-label="Portal" className="flex">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            aria-current={tab === key ? "page" : undefined}
            onClick={() => onTab(key)}
            className={`flex items-center gap-2.5 border-r border-barline px-5.5 text-[14.5px] font-[650] transition-colors ${tab === key ? "bg-white text-ink" : "text-bartext hover:bg-[#221D1A] hover:text-white"}`}
          >
            <Icon size={17} weight="bold" />
            {label}
          </button>
        ))}
      </nav>
      <div className="ml-auto flex">
        <div className="relative flex border-l border-barline">
          <button type="button" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)} className="flex items-center gap-2.5 px-5.5 text-[14px] text-bartext">
            Area <b className="font-[650] text-white">{area.name}</b>
            <CaretDown size={14} weight="bold" className={`text-white transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
          {open && (
            <div role="listbox" className="absolute top-14 right-0 w-[330px] border-2 border-t-0 border-ink bg-white text-ink shadow-[0_14px_30px_rgba(20,17,16,.18)]">
              {AREAS.map((item) => {
                const Icon = AREA_ICON[item.icon];
                return (
                  <button
                    key={item.key}
                    type="button"
                    role="option"
                    aria-selected={item.key === area.key}
                    onClick={() => pick(item.key)}
                    className={`grid w-full grid-cols-[22px_1fr] gap-x-3 border-b border-line px-4.5 py-3.5 text-left last:border-b-0 hover:bg-hover ${item.key === area.key ? "bg-hover shadow-[inset_4px_0_0_var(--color-high)]" : ""}`}
                  >
                    <Icon size={20} weight="bold" className="row-span-2 mt-0.5" />
                    <b className="text-[15px] font-bold">{item.name}</b>
                    <small className="text-[13px] text-muted">{item.place}</small>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        {loginNeeded && (
          <div className="flex items-center gap-3 border-l border-barline pr-2.5 pl-5.5 text-[14px] text-bartext">
            <b className="font-[650] text-white">{email || "Signed in"}</b>
            <button type="button" aria-label="Sign out" onClick={logout} className="grid size-10 place-items-center hover:text-white">
              <SignOut size={19} weight="bold" />
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
