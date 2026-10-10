import { api } from "./client";

const checks = {};

// The agent and voice endpoints answer 501 NOT_IMPLEMENTED until their code is in (api.md §3), and the
// app hides those features until then. An empty body can't start any work on the server: a live
// endpoint turns it down as a bad request, a stub says 501. Asked once per endpoint and page load.
export function isLive(path) {
  checks[path] =
    checks[path] ||
    api
      .post(path, {})
      .then(() => true)
      .catch((err) => Boolean(err.response) && err.response.status !== 501);
  return checks[path];
}
