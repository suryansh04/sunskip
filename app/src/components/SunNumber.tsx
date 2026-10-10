import { useEffect, useRef, useState } from "react";
import { fmt } from "../format";

const ROLL_MS = 420;

// The big minutes-in-sun number. A new value rolls from the old one (420 ms, ease-out);
// null is "unknown", smaller and muted, never 0.
export default function SunNumber({ value, className = "" }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);

  useEffect(() => {
    const start = from.current;
    from.current = value;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (still || start === null || value === null || start === value) {
      setShown(value);
      return;
    }
    const began = performance.now();
    let frame = requestAnimationFrame(function roll(time) {
      const progress = Math.min(1, (time - began) / ROLL_MS);
      setShown(start + (value - start) * (1 - Math.pow(1 - progress, 3)));
      if (progress < 1) frame = requestAnimationFrame(roll);
    });
    return () => cancelAnimationFrame(frame);
  }, [value]);

  if (value === null) return <b className="text-[22px] leading-[1.6] font-[650] text-muted">unknown</b>;
  return <b className={`wide font-[760] ${className}`}>{fmt(shown)}</b>;
}
