import { Bus, CaretRight, Clock, FlagCheckered, PersonSimpleWalk, Taxi, TrainSimple } from "@phosphor-icons/react";
import { duration, fmt, timeOf } from "../format";
import { sunBit } from "../geo";
import SunStrip from "./SunStrip";
import LegRow from "./LegRow";

const MODE = {
  WALK: { Icon: PersonSimpleWalk, dot: "bg-sunken", rail: "bg-line" },
  ERICKSHAW: { Icon: Taxi, dot: "bg-sunken", rail: "bg-line" },
  BUS: { Icon: Bus, dot: "bg-ink text-white", rail: "bg-ink" },
  RAIL: { Icon: TrainSimple, dot: "bg-ink text-white", rail: "bg-ink" },
  METRO: { Icon: TrainSimple, dot: "bg-metro text-white", rail: "bg-ink" },
};

function titleOf(leg, endName) {
  if (leg.mode === "WALK") return `Walk ${leg.distanceMeters} m`;
  if (leg.mode === "ERICKSHAW") return `E-rickshaw to ${endName}`;
  if (leg.mode === "BUS") return `Bus ${leg.line?.shortName || ""} to ${endName}`;
  return `${leg.line?.shortName || (leg.mode === "METRO" ? "Metro" : "Train")} to ${endName}`;
}

function detailOf(leg) {
  const time = duration(leg.durationSeconds);
  if (leg.mode === "WALK") return leg.exposure?.sunMinutes == null ? `${time} · minutes in sun unknown` : `${time} · ${fmt(leg.exposure.sunMinutes)} min in sun`;
  if (leg.mode === "ERICKSHAW") return leg.fareInr === null ? `${time} · fare unknown` : `${time} · ₹${leg.fareInr}, estimated`;
  return `${time} · board at ${timeOf(leg.startAt)}`;
}

function stopShade(leg) {
  return leg.stopShaded === true ? "the stop has shade" : leg.stopShaded === false ? "the stop has no shade" : "stop shade unknown";
}

// One row per leg, with the wait before each ride and the arrival at the end (design.md §7).
// A walk that starts the trip opens the walk detail.
export default function LegsTimeline({ option, points, destinationName, onOpenWalk }) {
  return (
    <ol className="mx-5 mt-4 border-t border-line pt-3.5">
      {option.legs.map((leg, i) => {
        const mode = MODE[leg.mode];
        const endName = leg.to.name || option.legs[i + 1]?.from.name || destinationName;
        const bits = points.filter((point) => point.legIndex === i).map((point) => sunBit(point.inSun));
        const opensWalk = leg.mode === "WALK" && i === 0;
        const row = (
          <LegRow dot={{ Icon: mode.Icon, style: mode.dot }} rail={mode.rail} title={titleOf(leg, endName)} detail={detailOf(leg)}>
            {bits.length > 1 && <SunStrip bits={bits} className="mt-2 h-2" />}
          </LegRow>
        );
        return (
          <li key={i}>
            {leg.waitSeconds > 0 && (
              <LegRow
                dot={{ Icon: Clock, style: leg.stopShaded === true ? "bg-shade-tint text-shade-text" : "bg-sun-tint text-sun-text" }}
                rail="bg-line"
                title={`Wait ${Math.round(leg.waitSeconds / 60)} min at ${leg.from.name || "the stop"}`}
                detail={`About ${Math.round(leg.waitSeconds / 60)} min, ${stopShade(leg)}`}
                hot={leg.stopShaded === false}
              />
            )}
            {opensWalk ? (
              <button type="button" onClick={() => onOpenWalk(leg, endName)} className="flex w-full items-center">
                {row}
                <CaretRight size={18} weight="bold" className="flex-none text-muted" />
              </button>
            ) : (
              row
            )}
          </li>
        );
      })}
      <li>
        <LegRow dot={{ Icon: FlagCheckered, style: "bg-ink text-white" }} rail="" title={destinationName} detail={`Arrive ${timeOf(option.arriveAt)}`} />
      </li>
    </ol>
  );
}
