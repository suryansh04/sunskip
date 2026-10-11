import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 5174,
      strictPort: true, // Cognito only sends people back to this exact address
      proxy: {
        "/v1": { target: env.API_PROXY_TARGET || "http://localhost:8000", changeOrigin: true },
      },
    },
  };
});
