import { api } from "./client";

let meta = null;

// Whether the agent ("agent") or voice ("voice") is live yet: /meta says so (api.md endpoint 1), and the app
// hides those features until then. Asked once per page load.
export function isLive(feature) {
  meta =
    meta ||
    api
      .get("/meta")
      .then((res) => res.data.features || {})
      .catch(() => ({}));
  return meta.then((features) => Boolean(features[feature]));
}
