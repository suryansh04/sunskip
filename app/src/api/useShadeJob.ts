import { useEffect, useRef, useState } from "react";
import { api } from "./client";

const POLL_MS = 3000;
const GIVE_UP_MS = 120000;

// TRD §2.5: while shade data is being prepared, poll its job every 3 s. Calls onReady when the
// data is in (so the page can ask again) and gives up after 2 min or when the job fails.
export default function useShadeJob(shade, onReady) {
  const [progress, setProgress] = useState(null);
  const [gaveUp, setGaveUp] = useState(false);
  const ready = useRef(onReady);
  ready.current = onReady;

  useEffect(() => {
    setProgress(null);
    setGaveUp(false);
    if (shade?.status !== "PREPARING" || !shade.jobId) return;
    const started = Date.now();
    const timer = setInterval(() => {
      api
        .get(`/shade/jobs/${shade.jobId}`)
        .then((res) => {
          setProgress(res.data);
          if (res.data.readyToReplan) {
            clearInterval(timer);
            ready.current();
            return;
          }
          if (res.data.status === "FAILED" || Date.now() - started > GIVE_UP_MS) {
            clearInterval(timer);
            setGaveUp(true);
          }
        })
        .catch(() => {
          clearInterval(timer);
          setGaveUp(true);
        });
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [shade?.jobId]);

  return { progress, gaveUp };
}
