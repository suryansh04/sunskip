import { useEffect, useRef, useState } from "react";
import { api } from "./client";
import { planRequest } from "../session";
import { istIso, now } from "../format";

const OFF_PATH_M = 30; // further than this from the path...
const OFF_FOR_MS = 8000; // ...for this long means a wrong turn, not a GPS wobble
const TRY_GAP_MS = 20000; // at most one new plan this often
const TRUSTED_FIX_M = 30; // a fix less sure than this can't tell a wrong turn from a wobble

function isOff(fix, snap) {
  return Boolean(fix && snap && fix.accuracyM <= TRUSTED_FIX_M && snap.offsetM > OFF_PATH_M);
}

// The walk-only option of a plan with the fewest sun minutes, or the first when a count is unknown
function shadiestWalk(options) {
  const onFoot = options.filter((option) => option.legs.every((leg) => leg.mode === "WALK"));
  if (onFoot.some((option) => option.exposure.sunMinutes === null)) return onFoot[0];
  return onFoot.sort((a, b) => a.exposure.sunMinutes - b.exposure.sunMinutes)[0];
}

// Like a sat-nav: when the walker has left the path, plan a new walk from where they are to the end
// of this walk. Returns the new walk ({ tripId, optionId, points }) once there is one.
export default function useReroute(fix, snap, end, resetKey) {
  const [reroute, setReroute] = useState(null);
  const [rerouting, setRerouting] = useState(false);
  const latest = useRef({ fix, snap });
  latest.current = { fix, snap };
  const timer = useRef(null);
  const lastTry = useRef(0);

  useEffect(() => setReroute(null), [resetKey]);
  useEffect(() => () => clearTimeout(timer.current), []);

  useEffect(() => {
    if (!isOff(fix, snap)) {
      clearTimeout(timer.current);
      timer.current = null;
      return;
    }
    if (timer.current || rerouting) return;
    timer.current = setTimeout(planFromHere, Math.max(OFF_FOR_MS, lastTry.current + TRY_GAP_MS - Date.now()));
  }, [snap]);

  function planFromHere() {
    timer.current = null;
    const here = latest.current.fix;
    if (!end || !isOff(here, latest.current.snap)) return;
    lastTry.current = Date.now();
    setRerouting(true);
    api
      .post("/routes/plan", planRequest(here, end, istIso(now())))
      .then((res) => {
        const option = shadiestWalk(res.data.options);
        if (!option) return;
        const { tripId } = res.data;
        return api.get(`/routes/${tripId}/options/${option.optionId}/waypoints`).then((points) => {
          if (points.data.waypoints.length > 1) setReroute({ tripId, optionId: option.optionId, points: points.data.waypoints });
        });
      })
      .catch(() => null) // keep guiding on the old path; the next wrong-turn check tries again
      .finally(() => setRerouting(false));
  }

  return { reroute, rerouting };
}
