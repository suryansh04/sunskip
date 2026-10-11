// Mock answers for VITE_USE_MOCKS=true: captures of the real portal API for MUJ and the Bus 26 stop.

const files = import.meta.glob("./*.json");
const DELAY_MS = 300;

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

// Every area answers with the MUJ captures; the simulator answers with the run of the best tree plan
export default async function fixtures(config) {
  const path = config.url.split("?")[0];
  const params = config.params || {};
  const stretchId = path.match(/^\/portal\/stretches\/(.+)$/)?.[1];
  await wait(DELAY_MS);
  if (path === "/portal/heat-pain") return read("heat-pain");
  if (path === "/portal/recommendations") return { recommendations: (await read("recommendations"))[params.type || "TREE"] };
  if (path === "/portal/simulate") return read("simulate");
  if (path === "/portal/stats") return read("stats");
  if (path === "/shade/segments") return read("segments");
  if (stretchId) {
    const stretch = (await read("stretches"))[stretchId];
    if (stretch) return stretch;
    throw fail(config, 404, "NOT_FOUND", "Unknown stretch");
  }
  throw fail(config, 404, "NOT_FOUND", `No fixture for ${config.method.toUpperCase()} ${path}`);
}
