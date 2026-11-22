/**
 * Rdzeń benchmarku: bridge (mock, serwuje zbudowaną aplikację) + Chromium/Edge (Playwright).
 * Dla każdej pary (Hz, ekran, tier): nowa strona, rozgrzewka, pomiar rAF w stronie + metryki CDP
 * (Performance.getMetrics przed/po) i opcjonalny trace (Tracing).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium, type Browser, type CDPSession, type Page } from "playwright-core";
import { createMockSource, type MockScenario } from "@yoga-auto/mock";
import { startBridge } from "../../../bridge/src/server.ts";
import { PROBE_SOURCE, type ProbeResult } from "./page-probe.ts";
import type { BenchReport, BenchRun } from "./report.ts";
import { analyzeFrames } from "./stats.ts";

export const BENCH_PORT = 7424;
export const ROOT = resolve(import.meta.dirname, "../../..");
export const DIST = resolve(ROOT, "apps/yoga/dist");

export interface ScreenSpec {
  name: string;
  /** etykieta przycisku docka (aria-label); null = Home (bez klikania) */
  dock: string | null;
}

export const DEFAULT_SCREENS: ScreenSpec[] = [
  { name: "Home", dock: null },
  { name: "Drive", dock: "Jazda" },
  { name: "Vehicle", dock: "Pojazd" },
  { name: "Diagnostics", dock: "Diagnostyka" },
];
export const DEFAULT_TIERS = ["ultra", "high", "lite", "flat"];

export interface BenchOptions {
  seconds: number;
  warmupSeconds: number;
  tiers: string[];
  hz: (30 | 60)[];
  screens: ScreenSpec[];
  scenario: MockScenario;
  build: boolean;
  trace: boolean;
  outDir: string;
  channel: string | undefined;
  headed: boolean;
  log: (s: string) => void;
}

export function buildApp(log: (s: string) => void): void {
  log("build apps/yoga …");
  const r = spawnSync("npm run build -w @yoga-auto/yoga", { cwd: ROOT, shell: true, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`build failed:\n${r.stdout}\n${r.stderr}`);
}

async function launch(o: BenchOptions): Promise<{ browser: Browser; label: string }> {
  const tryChannels = o.channel ? [o.channel] : process.platform === "win32" ? ["msedge", "chrome", ""] : ["", "chrome"];
  let lastErr: unknown;
  for (const ch of tryChannels) {
    try {
      const browser = await chromium.launch({
        ...(ch ? { channel: ch } : {}),
        headless: !o.headed,
        args: ["--disable-background-timer-throttling", "--disable-renderer-backgrounding"],
      });
      return { browser, label: `${ch || "chromium"} ${browser.version()}` };
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(
    `Brak przeglądarki: zainstaluj Edge/Chrome albo uruchom \`npx playwright install chromium\`. (${String(lastErr).split("\n")[0]})`,
  );
}

/** Wymusza `data-tier` na <html> (MutationObserver odpiera nadpisanie przez GlassProvider/auto-degradację). */
const forceTier = (tier: string) => `(() => {
  const t = ${JSON.stringify(tier)};
  const force = () => { const el = document.documentElement; if (el.dataset.tier !== t) el.dataset.tier = t; };
  new MutationObserver(force).observe(document.documentElement, { attributes: true, attributeFilter: ["data-tier"] });
  document.addEventListener("DOMContentLoaded", force);
})()`;

function metricMap(m: { metrics: { name: string; value: number }[] }): Record<string, number> {
  return Object.fromEntries(m.metrics.map((x) => [x.name, x.value]));
}

async function measure(cdp: CDPSession, page: Page, seconds: number) {
  await cdp.send("Performance.enable");
  const a = metricMap(await cdp.send("Performance.getMetrics"));
  const probe = (await page.evaluate(`(${PROBE_SOURCE})(${seconds * 1000})`)) as ProbeResult;
  const b = metricMap(await cdp.send("Performance.getMetrics"));
  const d = (k: string) => Math.round(((b[k] ?? 0) - (a[k] ?? 0)) * 1000);
  return {
    probe,
    cdp: {
      scriptMs: d("ScriptDuration"),
      taskMs: d("TaskDuration"),
      layoutMs: d("LayoutDuration"),
      styleRecalcMs: d("RecalcStyleDuration"),
      heapMB: Math.round(((b["JSHeapUsedSize"] ?? 0) / 1048576) * 10) / 10,
    },
  };
}

export async function runBench(o: BenchOptions): Promise<BenchReport> {
  if (o.build || !existsSync(resolve(DIST, "index.html"))) buildApp(o.log);
  mkdirSync(o.outDir, { recursive: true });
  const { browser, label } = await launch(o);
  const runs: BenchRun[] = [];
  const viewport = { width: 1280, height: 800 };
  try {
    for (const hz of o.hz) {
      const bridge = await startBridge({
        source: createMockSource({ scenario: o.scenario, speed: 1 }),
        port: BENCH_PORT,
        host: "127.0.0.1",
        auth: false,
        fastHz: hz,
        staticDir: DIST,
        log: () => {},
      });
      try {
        for (const screen of o.screens)
          for (const tier of o.tiers) {
            const ctx = await browser.newContext({ viewport });
            const page = await ctx.newPage();
            await page.addInitScript(forceTier(tier));
            try {
              await page.goto(`http://127.0.0.1:${BENCH_PORT}/?bench=1&tier=${tier}&hz=${hz}`);
              await page.waitForSelector(".shell", { timeout: 10_000 });
              if (screen.dock) {
                const btn = page.getByRole("button", { name: screen.dock, exact: true });
                if ((await btn.count()) === 0) {
                  runs.push({ screen: screen.name, tier, appliedTier: null, hz, skipped: `brak przycisku docka „${screen.dock}”` });
                  continue;
                }
                await btn.click();
              }
              await page.waitForTimeout(o.warmupSeconds * 1000);
              const cdp = await ctx.newCDPSession(page);
              const tracePath = resolve(o.outDir, `trace-${screen.name}-${tier}-${hz}.json`);
              const chunks: unknown[] = [];
              if (o.trace) {
                cdp.on("Tracing.dataCollected", (e: { value: unknown[] }) => chunks.push(...e.value));
                await cdp.send("Tracing.start", {
                  categories: "devtools.timeline,disabled-by-default-devtools.timeline.frame,benchmark,cc",
                  transferMode: "ReportEvents",
                });
              }
              const { probe, cdp: m } = await measure(cdp, page, o.seconds);
              if (o.trace) {
                const done = new Promise((r) => cdp.once("Tracing.tracingComplete", r));
                await cdp.send("Tracing.end");
                await done;
                writeFileSync(tracePath, JSON.stringify({ traceEvents: chunks }));
              }
              const run: BenchRun = {
                screen: screen.name,
                tier,
                appliedTier: probe.tier,
                hz,
                frames: analyzeFrames(probe.deltas.slice(1)),
                cdp: m,
                ...(o.trace ? { trace: tracePath } : {}),
              };
              runs.push(run);
              o.log(
                `${screen.name.padEnd(12)} ${tier.padEnd(6)} ${hz}Hz  ${run.frames!.fps} fps  p95 ${run.frames!.frameMs.p95} ms  dropped ${run.frames!.droppedPct}%`,
              );
            } finally {
              await ctx.close();
            }
          }
      } finally {
        await bridge.close();
      }
    }
  } finally {
    await browser.close();
  }
  return {
    generatedAt: new Date().toISOString(),
    browser: label,
    viewport: [viewport.width, viewport.height],
    seconds: o.seconds,
    runs,
  };
}
