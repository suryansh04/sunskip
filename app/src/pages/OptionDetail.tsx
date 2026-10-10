import { useState } from "react";
import { useNavigate } from "react-router";
import { CaretRight, NavigationArrow } from "@phosphor-icons/react";
import { api } from "../api/client";
import { duration, fareText, fmt, labelsText } from "../format";
import { remember } from "../session";
import Sheet from "../components/Sheet";
import Button from "../components/Button";
import LegsTimeline from "../components/LegsTimeline";
import WaitLine from "../components/WaitLine";

// One route option, leg by leg (screens 10 and 11). Results renders it over its map.
export default function OptionDetail({ tripId, option, points, search, onResize, onExpired }) {
  const navigate = useNavigate();
  const [starting, setStarting] = useState(false);
  const sun = option.exposure.sunMinutes;

  function takeRoute() {
    const startTrip = () => navigate(`/trip/${tripId}/${option.optionId}`);
    setStarting(true);
    // The choice is the portal's demand signal. Only an expired trip (404) stops the walk; any other failed log doesn't.
    api
      .post(`/routes/${tripId}/choice`, { optionId: option.optionId })
      .then(startTrip)
      .catch((err) => (err.response?.status === 404 ? onExpired() : startTrip()));
  }

  function openWalk(leg, endName) {
    const ride = option.legs[1];
    const stop = ride?.mode === "BUS" && ride.line?.shortName ? `Bus ${ride.line.shortName} stop` : endName;
    remember("walk", {
      title: ride?.mode === "BUS" && ride.line?.shortName ? `Walk to the ${stop}` : `Walk to ${stop}`,
      from: { ...leg.from.location, name: leg.from.name || search.origin.name || "Start" },
      to: { ...leg.to.location, name: stop },
      at: option.departAt,
      partOfTrip: option.legs.length > 1,
    });
    navigate("/walk");
  }

  return (
    <Sheet label="Route option" className="top-[34%] overflow-y-auto overscroll-contain" onResize={onResize}>
      <section className="px-5 pt-2.5">
        <div className="mb-1.5 text-[15px] font-bold text-muted">{labelsText(option.labels) || "Route option"}</div>
        <div className="flex items-end gap-3">
          {sun === null ? <b className="text-[22px] leading-[1.6] font-[650] text-muted">unknown</b> : <b className="wide mr-1.5 text-[84px] leading-[.9] font-[760] tracking-[-2px]">{fmt(sun)}</b>}
          <span className="pb-1.5 text-[18px] leading-[1.2] font-semibold">
            min walking
            <br />
            in direct sun
          </span>
        </div>
        <p className="mt-2.5 text-[15px] text-muted">{`${duration(option.durationSeconds)} · ${option.exposure.walkMeters} m on foot · ${fareText(option, ", estimated")}`}</p>
        <WaitLine exposure={option.exposure} className="mt-2.5" />
      </section>

      <LegsTimeline option={option} points={points} destinationName={search.destination.name} onOpenWalk={openWalk} />

      <button type="button" onClick={() => navigate("/best-time")} className="mx-5 mt-2 flex min-h-12 w-[calc(100%-40px)] items-center justify-between font-[650] text-shade-text">
        Best time to leave
        <CaretRight size={20} weight="bold" />
      </button>
      <div className="sticky bottom-0 z-[2] mt-3 border-t border-line bg-white px-5 pt-3 pb-[calc(14px+env(safe-area-inset-bottom))]">
        <Button onClick={takeRoute} disabled={starting}>
          <NavigationArrow size={20} weight="fill" />
          {starting ? "Starting…" : "Take this route"}
        </Button>
      </div>
    </Sheet>
  );
}
