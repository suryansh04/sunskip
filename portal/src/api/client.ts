import axios from "axios";
import fixtures from "./fixtures";

function clientId() {
  let id = localStorage.getItem("clientId");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("clientId", id);
  }
  return id;
}

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL,
  timeout: 30000,
});

api.interceptors.request.use((config) => {
  config.headers["X-Client-Id"] = clientId();
  const token = localStorage.getItem("idToken"); // portal only
  if (token) config.headers["Authorization"] = "Bearer " + token;
  if (import.meta.env.VITE_USE_MOCKS === "true") {
    config.adapter = async () => ({
      data: await fixtures(config),
      status: 200,
      statusText: "OK",
      headers: {},
      config,
    });
  }
  return config;
});
