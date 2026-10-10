import { useState } from "react";
import { CheckCircle } from "@phosphor-icons/react";
import { boundsOf, optionLines } from "../geo";
import { dayWord, duration, fareText, timeOf } from "../format";
import MapView from "./MapView";
import Sheet from "./Sheet";
import Button from "./Button";
import LegsTimeline from "./LegsTimeline";

// A route with no walking (an e-rickshaw or rides only): there is nothing to guide on foot, so show the
// ride on the map and its steps, with the time to arrive.
export default function RideGuide({ option, destinationName, onDone }) {
  const [sheetHeight, setSheetHeight] = useState(0);
  const coords = option.legs.flatMap((leg) => leg.polyline.coordinates);
  const lastStop = option.legs[option.legs.length - 1].to.name;
  return (
    <main>
      <MapView
        camera={{ bounds: boundsOf(coords) }}
        padding={{ top: 60, bottom: sheetHeight + 40, left: 40, right: 40 }}
        streets={null}
        lines={optionLines(option, [])}
        start={coords[0]}
        end={coords[coords.length - 1]}
        you={null}
        creditBottom={sheetHeight + 6}
        onMoved={null}
      />
      <Sheet label="Your ride" className="max-h-[70%] overflow-y-auto overscroll-contain px-0 pb-[calc(16px+env(safe-area-inset-bottom))]" onResize={setSheetHeight}>
        <div className="px-5 pt-2.5">
          <b className="block text-[22px] leading-[1.2] font-bold [font-stretch:112%]">No walking on this route</b>
          <p className="mt-1 text-[15px] text-muted">{`${duration(option.durationSeconds)} · ${fareText(option, ", estimated")} · arrive ${timeOf(option.arriveAt)}${dayWord(option.arriveAt)}`}</p>
        </div>
        <LegsTimeline option={option} points={[]} destinationName={lastStop || destinationName || "Your destination"} onOpenWalk={null} />
        <div className="mx-5 mt-2">
          <Button onClick={onDone}>
            <CheckCircle size={20} weight="bold" />
            I've arrived
          </Button>
        </div>
      </Sheet>
    </main>
  );
}
