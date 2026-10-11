import { createFixSmoother, watchGps } from "./features/ar/gps";

const GOOD_M = 10; // stop looking once the fix is this close
const MAX_MS = 20000; // or after this long, keeping the best fix so far
export const ROUGH_M = 500; // still worse than this at the end: the phone shares only an approximate location

// Where the phone is, as exactly as it can tell. The first fix is often a rough Wi-Fi or cell-tower
// guess, so keep listening through the GPS filter until a fix is within GOOD_M or time runs out.
// onFix gets each better fix; onDone gets the best fix (null if none) and why the watch failed, if it did.
// Returns a function that stops looking.
export function locate(onFix, onDone) {
  const smoother = createFixSmoother();
  let best = null;
  let failure = null;
  let done = false;
  const stopWatch = watchGps(
    (raw) => {
      const fix = smoother.push(raw);
      if (!fix) return;
      best = fix;
      onFix(fix);
      if (fix.accuracyM <= GOOD_M) finish();
    },
    (reason) => {
      failure = reason;
      // A timeout after a fix only means the phone stood still; keep the time we have left
      if (reason !== "timeout" || !best) finish();
    },
  );
  const timer = setTimeout(finish, MAX_MS);
  function stop() {
    done = true;
    clearTimeout(timer);
    stopWatch();
  }
  function finish() {
    if (done) return;
    stop();
    onDone(best, failure);
  }
  return stop;
}
