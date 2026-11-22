import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const bridge = process.env.YOGA_BRIDGE ?? "http://localhost:7420";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      "/ws": { target: bridge.replace(/^http/, "ws"), ws: true },
      "/api": bridge,
      "/media": bridge,
      "/tiles": bridge,
    },
  },
  build: { target: "es2022", sourcemap: true },
});
