import { api } from "./client";
import { planRequest } from "../session";

// One walk planned on its own at a leave time. The plan answers with the walk, a shadier copy of it
// when there is one, and the e-rickshaw that could replace it; then the walk's waypoints are loaded.
// Each hour needs its own plan: the sun on every piece of the path changes with the time.
export function planWalk(walk, departAt) {
  return api.post("/routes/plan", planRequest(walk.from, walk.to, departAt)).then((plan) => {
    const { tripId, conditions, options } = plan.data;
    const onFoot = options.filter((option) => option.legs.every((leg) => leg.mode === "WALK"));
    // The shadier copy is the one with fewer sun minutes; with a minute count unknown, neither is called shadier
    const known = onFoot.every((walkOption) => walkOption.exposure.sunMinutes !== null);
    const [option, shadier] = known ? onFoot.sort((a, b) => b.exposure.sunMinutes - a.exposure.sunMinutes) : [onFoot[0], null];
    const erickshaw = options.find((candidate) => candidate.legs.every((leg) => leg.mode === "ERICKSHAW"));
    const planned = { tripId, conditions, option: option || null, shadier: shadier || null, erickshaw: erickshaw || null, points: [] };
    if (!option) return planned;
    return api.get(`/routes/${tripId}/options/${option.optionId}/waypoints`).then((res) => ({ ...planned, points: res.data.waypoints }));
  });
}

// The same planned walk with the sun read for leaving at another time (waypoints ?at=, api.md endpoint 7).
// No new plan, so tapping hours doesn't count as more trips.
export function walkPointsAt(planned, at) {
  return api.get(`/routes/${planned.tripId}/options/${planned.option.optionId}/waypoints`, { params: { at } }).then((res) => res.data.waypoints);
}
