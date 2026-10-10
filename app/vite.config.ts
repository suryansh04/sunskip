import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [
      react(),
      tailwindcss(),
      // Phones only share the camera, GPS and compass with HTTPS pages
      basicSsl(),
      VitePWA({
        registerType: "autoUpdate",
        manifest: {
          name: "SunSkip",
          short_name: "SunSkip",
          theme_color: "#F2994A",
          background_color: "#ffffff",
          display: "standalone",
          start_url: "/",
          icons: [{ src: "/icon-512.png", sizes: "512x512", type: "image/png" }],
        },
      }),
    ],
    server: {
      port: 5173,
      host: true,
      proxy: {
        "/v1": { target: env.API_PROXY_TARGET || "http://localhost:8000", changeOrigin: true },
      },
    },
  };
});
