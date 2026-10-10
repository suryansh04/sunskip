import { Bus, CaretRight, PersonSimpleWalk, Taxi, TrainSimple } from "@phosphor-icons/react";

const ICON_PX = 17;

function chipOf(leg) {
  if (leg.mode === "WALK") return { style: "bg-sunken", Icon: PersonSimpleWalk, text: "", name: "Walk" };
  if (leg.mode === "ERICKSHAW") return { style: "bg-[#EFE6DA]", Icon: Taxi, text: "E-rick", name: "E-rickshaw" };
  if (leg.mode === "METRO") return { style: "bg-metro text-white", Icon: TrainSimple, text: "Metro", name: "Metro" };
  if (leg.mode === "RAIL") return { style: "bg-ink text-white", Icon: TrainSimple, text: leg.line?.shortName || "Train", name: "Train" };
  return { style: "bg-ink text-white", Icon: Bus, text: leg.line?.shortName || "", name: "Bus" };
}

// The modes of a route in order: [E-rick] › [26] › [walk] › [Metro]
export default function ModeChain({ legs }) {
  return (
    <span className="flex flex-wrap items-center gap-0.5">
      {legs.map((leg, i) => {
        const chip = chipOf(leg);
        return (
          <span key={i} className="inline-flex items-center gap-0.5">
            <span className={`inline-flex h-[30px] items-center gap-[3px] rounded-lg px-1.5 text-[14px] font-bold ${chip.style}`}>
              <chip.Icon size={ICON_PX} weight="bold" aria-label={chip.name} />
              {chip.text}
            </span>
            {i < legs.length - 1 && <CaretRight size={11} weight="bold" className="text-unknown" aria-hidden />}
          </span>
        );
      })}
    </span>
  );
}
