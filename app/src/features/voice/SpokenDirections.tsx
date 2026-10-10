import { useEffect, useState } from "react";
import { Waveform } from "@phosphor-icons/react";
import { api } from "../../api/client";
import { isLive } from "../../api/live";
import { hush, say } from "./speech";

const FALLBACK_LANGUAGE = "en-IN"; // the waypoint cues are English

// Spoken directions for one walk (api.md endpoint 10): says each step when the walker reaches it
// and shows what is being said. `points` are the walk's waypoints and `at` the one the walker is at.
// Until voice is live (/meta features), or when it fails, the waypoint cues are read by the browser.
export default function SpokenDirections({ tripId, optionId, points, at, muted, caption, language }) {
  const [steps, setSteps] = useState([]);
  const [spokenIn, setSpokenIn] = useState(language);

  useEffect(() => {
    const cueSteps = points
      .filter((point) => point.cue)
      .map((point, index) => ({ index, triggerAtMeters: point.distanceFromStartM, text: point.cue, audioUrl: null }));
    const useCues = () => {
      setSteps(cueSteps);
      setSpokenIn(FALLBACK_LANGUAGE);
    };
    isLive("voice").then((live) =>
      live
        ? api
            .post("/voice/instructions", { tripId, optionId, language })
            .then((res) => setSteps(res.data.steps))
            .catch(useCues)
        : useCues(),
    );
    return hush;
  }, [tripId, optionId]);

  const walkedMeters = points[at].distanceFromStartM;
  const step = [...steps].reverse().find((candidate) => candidate.triggerAtMeters <= walkedMeters);

  useEffect(() => {
    if (!step || muted) return hush();
    say(step.text, spokenIn, step.audioUrl);
  }, [step?.index, muted]);

  if (!step || muted || !caption) return null;
  return (
    <div className="absolute inset-x-3 top-[110px] z-10 flex animate-fade items-center gap-2 rounded-xl bg-white/95 px-3 py-[9px] text-[15px] shadow-[0_2px_10px_rgba(40,25,10,.14)]">
      <Waveform size={20} weight="bold" className="flex-none animate-dot text-shade-text" aria-hidden />
      <span lang={spokenIn.slice(0, 2)}>{step.text}</span>
    </div>
  );
}
