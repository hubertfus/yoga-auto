/**
 * Playwright e2e na mocku. Uruchomienie (z korzenia repo):
 *   npx playwright test -c e2e              # albo: npm run e2e -w @yoga-auto/e2e
 *
 * Przeglądarka:
 *  - lokalnie (Windows): zainstalowany Microsoft Edge (`channel: "msedge"`) — nic się nie pobiera,
 *  - CI / Linux: headless Chromium; jednorazowo `npx playwright install chromium` (CI robi to samo),
 *  - własny kanał: E2E_CHANNEL=chrome|msedge|chromium (chromium = bundlowany Chromium Playwrighta).
 * Porty: bridge 7423 (w procesie testu, patrz fixtures.ts), Vite preview 5175.
 */
import { defineConfig } from "@playwright/test";

export const BRIDGE_PORT = 7423;
export const VITE_PORT = 5175;
const channel = process.env.E2E_CHANNEL ?? (process.env.CI ? "chromium" : process.platform === "win32" ? "msedge" : "chromium");

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.e2e.ts",
  outputDir: "./test-results",
  reporter: process.env.CI ? [["list"], ["html", { open: "never", outputFolder: "./playwright-report" }]] : "list",
  // jeden worker: testy dzielą stały port bridge'a (reconnect wymaga ponownego startu na tym samym porcie)
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  use: {
    baseURL: `http://127.0.0.1:${VITE_PORT}`,
    ...(channel === "chromium" ? {} : { channel }),
    headless: !process.env.E2E_HEADED,
    viewport: { width: 1280, height: 800 }, // proporcje zbliżone do Yogi
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    // build + preview (a nie `vite dev`): jak produkcja, a `preview` dziedziczy proxy /ws z server.proxy.
    // `vite dev` pada w F0 na niezgodności vite 7 / plugin-react (docs/proposals/s7-bug-vite-dev-refresh.md).
    command: `npm run build -w @yoga-auto/yoga && npm run preview -w @yoga-auto/yoga -- --host 127.0.0.1 --port ${VITE_PORT} --strictPort`,
    cwd: "..",
    url: `http://127.0.0.1:${VITE_PORT}/`,
    env: { YOGA_BRIDGE: `http://127.0.0.1:${BRIDGE_PORT}` },
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
