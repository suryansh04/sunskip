import { useEffect, useRef, useState } from "react";
import { api } from "./client";

const POLL_MS = 3000;
const GIVE_UP_MS = 120000;

// TRD §2.5: while shade data is being prepared, poll its job every 3 s. Calls onReady once when the
// data is in (so the page can ask again) and gives up after 2 min or when the job fails.
// Each poll waits for the last one to answer, and answers that arrive after the job changed are ignored.
// Depends on the whole `shade` object, so a reload that returns the same job ID still starts polling again.
export default function useShadeJob(shade, onReady) {
  const [progress, setProgress] = useState(null);
  const [gaveUp, setGaveUp] = useState(false);
  const ready = useRef(onReady);
  ready.current = onReady;

  useEffect(() => {
    setProgress(null);
    setGaveUp(false);
    if (shade?.status !== "PREPARING" || !shade.jobId) return;
    let cancelled = false;
    let timer = null;
    const started = Date.now();
    const stop = (failed) => {
      if (failed) setGaveUp(true);
      cancelled = true;
    };
    const poll = () => {
      api
        .get(`/shade/jobs/${shade.jobId}`)
        .then((res) => {
          if (cancelled) return;
          setProgress(res.data);
          if (res.data.readyToReplan) {
            stop(false);
            ready.current();
          } else if (res.data.status === "FAILED" || Date.now() - started > GIVE_UP_MS) {
            stop(true);
          } else {
            timer = setTimeout(poll, POLL_MS);
          }
        })
        .catch(() => {
          if (!cancelled) stop(true);
        });
    };
    timer = setTimeout(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [shade]);

  return { progress, gaveUp };
}
