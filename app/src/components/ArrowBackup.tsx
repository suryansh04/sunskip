import { useEffect, useRef, useState } from "react";
import { ArrowUp, CameraSlash, CubeFocus, MapTrifold } from "@phosphor-icons/react";
import { turnBetween } from "../geo";
import Button from "./Button";
import AheadCard from "./AheadCard";

const ARROW_LOOK = {
  d: "bg-shade-strong text-white shadow-[0_10px_30px_rgba(30,111,217,.3)]",
  s: "bg-sun text-ink shadow-[0_10px_30px_rgba(242,153,74,.35)]",
  u: "bg-unknown text-ink",
};

// The arrow backup (screen 16): one big arrow that points along the walk, blue in shade and orange in sun.
// It turns with the phone's compass; without one it points straight up, as in the instruction.
export default function ArrowBackup({ instruction, ahead, arrived, bearingDeg, cameraOff, onTryAr, onMap }) {
  const arrow = useRef(null);
  const walkBearing = useRef(bearingDeg);
  const [hasCompass, setHasCompass] = useState(false);
  walkBearing.current = bearingDeg;
  const compassEvent: any = window.DeviceOrientationEvent;

  useEffect(() => {
    // Set straight on the element: the compass fires many times a second
    function turnArrow(event) {
      // iPhones give the heading itself; Android gives alpha, which runs the other way round
      const heading = event.webkitCompassHeading ?? (event.absolute && event.alpha !== null ? 360 - event.alpha : null);
      if (heading === null || !arrow.current) return;
      arrow.current.style.transform = `rotate(${turnBetween(heading, walkBearing.current)}deg)`;
      setHasCompass(true);
    }
    window.addEventListener("deviceorientationabsolute", turnArrow);
    window.addEventListener("deviceorientation", turnArrow);
    return () => {
      window.removeEventListener("deviceorientationabsolute", turnArrow);
      window.removeEventListener("deviceorientation", turnArrow);
    };
  }, []);

  return (
    <div className="absolute inset-0 z-[3] flex animate-fade flex-col bg-paper">
      <div className="flex flex-1 flex-col items-center justify-center gap-1.5 pt-[90px]">
        <span ref={arrow} className={`grid size-[170px] place-items-center rounded-full transition-transform duration-200 ${ARROW_LOOK[ahead.bit]}`}>
          <ArrowUp size={110} weight="fill" aria-hidden />
        </span>
        <b className="wide mt-3.5 text-[44px] font-[760]">{arrived ? "0 m" : `${instruction.meters} m`}</b>
        <span className="text-[16px] text-muted">{arrived ? "You have arrived" : `${instruction.title}, then ${instruction.then === "arrive" ? "you arrive" : instruction.then}`}</span>
        {!hasCompass && typeof compassEvent?.requestPermission === "function" && (
          // iPhones only share the compass after a tap
          <button type="button" onClick={() => compassEvent.requestPermission()} className="min-h-11 font-[650] text-shade-text">
            Turn the arrow with my compass
          </button>
        )}
      </div>
      <div className="px-4 pb-[calc(16px+env(safe-area-inset-bottom))]">
        <AheadCard ahead={ahead} />
        {cameraOff && (
          <p className="mt-3 flex items-center gap-2 text-[14px] text-muted">
            <CameraSlash size={18} weight="bold" className="flex-none" />
            The camera isn't available, so SunSkip shows one arrow instead.
          </p>
        )}
        <div className="mt-4 flex gap-2.5">
          <Button ghost className="min-h-[52px]" onClick={onTryAr}>
            <CubeFocus size={20} weight="bold" />
            {cameraOff ? "Try AR again" : "AR"}
          </Button>
          <Button className="min-h-[52px]" onClick={onMap}>
            <MapTrifold size={20} weight="bold" />
            Map
          </Button>
        </div>
      </div>
    </div>
  );
}
