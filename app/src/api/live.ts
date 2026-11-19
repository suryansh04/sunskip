import { api } from "./client";

let meta = null;

// Whether the agent ("agent") or voice ("voice") is live yet: /meta says so (api.md endpoint 1), and the app
// hides those features until then. Asked once per page load; a failed ask (a network blip at launch)
// isn't kept, so the next check asks again.
export function isLive(feature) {
  meta =
    meta ||
    api
      .get("/meta")
      .then((res) => res.data.features || {})
      .catch(() => {
        meta = null;
        return {};
      });
  return meta.then((features) => Boolean(features[feature]));
}
