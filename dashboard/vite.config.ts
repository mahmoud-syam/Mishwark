import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// In production the API serves the built app at /dashboard (same origin, so
// the auth cookie is first-party). In dev, Vite proxies /api to the API.
export default defineConfig({
  base: "/dashboard/",
  plugins: [react(), tailwindcss()],
  server: {
    port: 3000,
    proxy: {
      "/api": { target: process.env.API_URL || "http://localhost:5000", changeOrigin: true },
    },
  },
});
