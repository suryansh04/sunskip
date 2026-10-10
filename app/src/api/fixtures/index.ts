// Mock answers for VITE_USE_MOCKS=true. The JSON files are captures of the real API for
// Fri 15 May, MUJ main gate to Mansarovar Metro Station (the numbers in docs/ui-screens.pdf).
// Open the app with ?state=preparing | noshade | noroute | offline to see those states;
// ?state=ready goes back to normal.

const files = import.meta.glob("./*.json");
const BUS_26_STOP = { lat: 26.8389404, lng: 75.5653743 };
const SHADE_HOURS = { first: 7, last: 19 };
const JOB_STEP_CELLS = 8;
const DELAY_MS = { plan: 900, chat: 1400, other: 250 };

const asked = new URLSearchParams(window.location.search).get("state");
if (asked) sessionStorage.setItem("mockState", asked);

let cellsDone = 0;
let shadeReady = false;

async function read(name) {
  const file: any = await files[`./${name}.json`]();
  return file.default;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fail(config, status, code, message) {
  const response = { status, data: { error: { code, message, requestId: "mock" } }, config };
  return Object.assign(new Error(message), { response, config, isAxiosError: true });
}

function hourOf(isoTime) {
  const hour = isoTime ? Number(isoTime.slice(11, 13)) : 13;
  return Math.min(Math.max(hour, SHADE_HOURS.first), SHADE_HOURS.last);
}

function isBus26Stop(place) {
  if (place.query) return /bus 26/i.test(place.query);
  return Math.abs(place.lat - BUS_26_STOP.lat) < 0.0005 && Math.abs(place.lng - BUS_26_STOP.lng) < 0.0005;
}

async function plan(config, body, state) {
  await wait(DELAY_MS.plan);
  if (isBus26Stop(body.destination)) return (await read("walk-plans"))[hourOf(body.departAt)];
  if (state === "noroute") throw fail(config, 422, "NO_ROUTE_FOUND", "No route found between these places");
  if (state === "noshade") return read("plan-noshade");
  if (state === "preparing" && !shadeReady) {
    const preparing = await read("plan-preparing");
    cellsDone = preparing.shade.cellsDone;
    return preparing;
  }
  return read("plan");
}

async function shadeJob(jobId) {
  const { shade } = await read("plan-preparing");
  cellsDone = Math.min(shade.cellsTotal, cellsDone + JOB_STEP_CELLS);
  shadeReady = cellsDone === shade.cellsTotal;
  return {
    jobId,
    status: shadeReady ? "DONE" : "RUNNING",
    reason: "PLAN",
    cellsTotal: shade.cellsTotal,
    cellsDone,
    cellsNoData: 0,
    pollAfterSeconds: 3,
    readyToReplan: shadeReady,
  };
}

async function waypoints(config, tripId, optionId, at) {
  if (tripId.startsWith("mock-walk-")) return (await read("walk-waypoints"))[at ? hourOf(at) : tripId.slice("mock-walk-".length)];
  const byOption = await read(tripId === "mock-trip" ? "waypoints" : "waypoints-noshade");
  if (!byOption[optionId]) throw fail(config, 404, "NOT_FOUND", "Unknown trip or option");
  return byOption[optionId];
}

async function bestTime(body, state) {
  if (isBus26Stop(body.destination)) {
    const walk = await read("best-time-walk");
    return { ...walk, slots: walk.slots.filter((slot) => slot.departAt.slice(11, 16) >= body.from) };
  }
  return read(state === "noshade" ? "best-time-noshade" : "best-time");
}

async function shadeSegments(params, state) {
  const { segments, sunFractionByHour } = await read("shade-segments");
  const sun = sunFractionByHour[params.hour];
  const features = segments.map((segment, i) => ({
    type: "Feature",
    properties: {
      id: segment.id,
      // Outside 7 AM to 7 PM the sun is down, which the API reports as 0
      sunFraction: state === "noshade" ? null : sun ? sun[i] : 0,
      lengthM: segment.lengthM,
      stretchId: null,
    },
    geometry: { type: "LineString", coordinates: segment.coordinates },
  }));
  const shade = { status: state === "noshade" ? "UNAVAILABLE" : "READY", jobId: null };
  return { month: Number(params.month), hour: Number(params.hour), shade, type: "FeatureCollection", features };
}

async function chat(body) {
  await wait(DELAY_MS.chat);
  const replies = await read("agent-replies");
  const { match, ...answer } = replies.find((reply) => new RegExp(reply.match, "i").test(body.message));
  const inHindi = body.language === "hi-IN";
  return {
    sessionId: body.sessionId || "mock-session",
    ...answer,
    reply: inHindi ? answer.reply : answer.englishReply,
    replyLanguage: inHindi ? "hi-IN" : "en-IN",
    audioUrl: null,
  };
}

export default async function fixtures(config) {
  const state = sessionStorage.getItem("mockState");
  if (state === "offline") throw Object.assign(new Error("Network Error"), { config, isAxiosError: true });

  const method = config.method.toUpperCase();
  const path = config.url.split("?")[0];
  const body = typeof config.data === "string" ? JSON.parse(config.data) : config.data || {};
  const params = config.params || {};
  const tripPath = path.match(/^\/routes\/([^/]+)\/(?:options\/([^/]+)\/waypoints|choice)$/);

  if (path === "/routes/plan") return plan(config, body, state);
  if (path === "/agent/chat") return chat(body);
  await wait(DELAY_MS.other);
  if (path === "/meta") return read("meta");
  if (path === "/conditions") return read(params.at?.slice(11, 13) === "07" ? "conditions-day" : "conditions");
  if (path === "/shade/segments") return shadeSegments(params, state);
  if (path.startsWith("/shade/jobs/")) return shadeJob(path.split("/").pop());
  if (path === "/routes/best-time") return bestTime(body, state);
  if (tripPath && method === "GET") return waypoints(config, tripPath[1], tripPath[2], params.at);
  if (tripPath) return "";
  if (path === "/voice/instructions") return read("voice-instructions");
  if (path === "/voice/tts") return { audioUrl: null, cached: false };
  if (path === "/voice/stt") {
    return { transcript: "kya 5 baje jaun to kam dhoop milegi?", language: "hi-IN", english: "If I go at 5, will there be less sun?" };
  }
  throw fail(config, 404, "NOT_FOUND", `No fixture for ${method} ${path}`);
}
