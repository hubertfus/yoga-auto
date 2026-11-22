#!/usr/bin/env node
/**
 * bench — benchmark fps dashboardu i latencji.
 *
 *   node tools/bench/src/cli.ts [--seconds 10] [--hz 30,60] [--tiers ultra,high,lite,flat]
 *                               [--screens Home,Drive=Jazda,Vehicle=Pojazd] [--scenario highway]
 *                               [--no-build] [--trace] [--out tools/bench/reports] [--channel msedge] [--headed]
 *   node tools/bench/src/cli.ts latency [--seconds 10] [--hz 60]
 *   node tools/bench/src/cli.ts snippet [--seconds 10]     # kod do wklejenia w konsolę na Yodze (?bench=1)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { MOCK_SCENARIOS, createMockSource, type MockScenario } from "@yoga-auto/mock";
import { startBridge } from "../../../bridge/src/server.ts";
import { measureLatency } from "./latency.ts";
import { manualSnippet } from "./page-probe.ts";
import { renderHtml } from "./report.ts";
import { DEFAULT_SCREENS, DEFAULT_TIERS, ROOT, runBench, type ScreenSpec } from "./run.ts";

const [first, ...rest] = process.argv.slice(2);
const sub = first && !first.startsWith("-") ? first : "run";
const { values } = parseArgs({
  args: sub === "run" ? process.argv.slice(2) : rest,
  options: {
    seconds: { type: "string", default: "10" },
    hz: { type: "string" },
    tiers: { type: "string", default: DEFAULT_TIERS.join(",") },
    screens: { type: "string" },
    scenario: { type: "string", default: "highway" },
    "no-build": { type: "boolean", default: false },
    trace: { type: "boolean", default: false },
    out: { type: "string", default: resolve(ROOT, "tools/bench/reports") },
    channel: { type: "string" },
    headed: { type: "boolean", default: false },
  },
});

const seconds = Number(values.seconds);

if (sub === "snippet") {
  console.log(manualSnippet(seconds));
} else if (sub === "latency") {
  const hz = Number(values.hz ?? 60) as 15 | 30 | 60;
  const bridge = await startBridge({
    source: createMockSource({ scenario: values.scenario as MockScenario }),
    port: 0,
    host: "127.0.0.1",
    auth: false,
    fastHz: hz,
    log: () => {},
  });
  const r = await measureLatency(bridge.port, seconds, hz);
  await bridge.close();
  console.log(JSON.stringify(r, null, 2));
} else {
  if (!MOCK_SCENARIOS.includes(values.scenario as MockScenario)) throw new Error(`unknown scenario ${values.scenario}`);
  const screens: ScreenSpec[] = values.screens
    ? values.screens.split(",").map((s) => {
        const [name, dock] = s.split("=");
        return { name: name!, dock: dock ?? (name === "Home" ? null : name!) };
      })
    : DEFAULT_SCREENS;
  const report = await runBench({
    seconds,
    warmupSeconds: 2,
    tiers: values.tiers!.split(","),
    hz: (values.hz ?? "30,60").split(",").map(Number) as (30 | 60)[],
    screens,
    scenario: values.scenario as MockScenario,
    build: !values["no-build"],
    trace: values.trace!,
    outDir: values.out!,
    channel: values.channel,
    headed: values.headed!,
    log: (s) => console.error(s),
  });
  mkdirSync(values.out!, { recursive: true });
  const stamp = report.generatedAt.replace(/[:.]/g, "-");
  const html = renderHtml(report);
  const json = JSON.stringify(report, null, 2);
  writeFileSync(resolve(values.out!, `bench-${stamp}.json`), json);
  writeFileSync(resolve(values.out!, `bench-${stamp}.html`), html);
  writeFileSync(resolve(values.out!, "latest.json"), json);
  writeFileSync(resolve(values.out!, "latest.html"), html);
  console.log(`raport: ${resolve(values.out!, "latest.html")}\n        ${resolve(values.out!, "latest.json")}`);
}
