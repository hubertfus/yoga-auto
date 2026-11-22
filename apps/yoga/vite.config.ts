import { readFileSync } from "node:fs";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const bridge = process.env.YOGA_BRIDGE ?? "http://localhost:7420";
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

// Ścieżki obsługiwane przez bridge: nigdy z cache service workera (network-only).
const BRIDGE_PATHS = /^\/(api|ws|media|tiles)(\/|$)/;

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [
    react(),
    VitePWA({
      // Manifest jest statyczny (public/manifest.webmanifest, linkowany w index.html).
      manifest: false,
      registerType: "autoUpdate",
      injectRegister: false, // rejestracja w src/shell/pwa.ts
      workbox: {
        // cache-first dla assetów aplikacji (precache z hashami)
        globPatterns: ["**/*.{js,css,html,woff2,png,svg,webmanifest}"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [BRIDGE_PATHS],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        // /api, /ws, /media, /tiles → zawsze sieć (telemetria, parowanie, okładki, mapa z Range)
        runtimeCaching: [{ urlPattern: ({ url }) => BRIDGE_PATHS.test(url.pathname), handler: "NetworkOnly" }],
      },
      devOptions: { enabled: false },
    }),
  ],
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
