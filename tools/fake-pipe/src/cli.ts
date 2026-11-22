#!/usr/bin/env node
/**
 * fake-pipe CLI — udawany plugin na `\\.\pipe\yoga-auto` (albo --path).
 *
 *   node tools/fake-pipe/src/cli.ts --scenario city-night
 *   node tools/fake-pipe/src/cli.ts --replay tools/recorder/samples/highway-60s.yarec --speed 2 --loop
 *   node tools/fake-pipe/src/cli.ts --faults drop:5000,garbage:0.02,stall:8000/4000
 *
 * Potem w drugim terminalu: node bridge/src/main.ts --source pipe --no-auth
 */
import { parseArgs } from "node:util";
import type { TelemetrySource } from "@yoga-auto/protocol";
import { MOCK_SCENARIOS, type MockScenario } from "@yoga-auto/mock";
import { parseFaults } from "./faults.ts";
import { FakePipeServer } from "./server.ts";

const { values } = parseArgs({
  options: {
    path: { type: "string" },
    scenario: { type: "string", default: "highway" },
    replay: { type: "string" },
    speed: { type: "string", default: "1" },
    loop: { type: "boolean", default: false },
    faults: { type: "string" },
    seed: { type: "string" },
    fps: { type: "string" },
    verbose: { type: "boolean", short: "v", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

if (values.help) {
  console.log(`fake-pipe [--path P] [--scenario ${MOCK_SCENARIOS.join("|")}] [--replay F.yarec --speed X --loop]
          [--faults drop:MS,drop-frames:N,garbage:P,garbage-kinds:a+b,oversize:MS,fragment:N,
                    stall:AFTER/LEN,ack-delay:MS,drop-acks,ack-fail,ipc:N,no-hello,input-disabled]
          [--seed N] [--fps N] [-v]`);
  process.exit(0);
}

const scenario = values.scenario as MockScenario;
if (!values.replay && !MOCK_SCENARIOS.includes(scenario)) {
  console.error(`unknown scenario ${scenario}; use: ${MOCK_SCENARIOS.join(", ")}`);
  process.exit(2);
}

let source: TelemetrySource | undefined;
if (values.replay) {
  const { ReplaySource } = await import("@yoga-auto/recorder");
  source = new ReplaySource({ file: values.replay, speed: Number(values.speed), loop: values.loop });
}

const server = new FakePipeServer({
  ...(values.path ? { path: values.path } : {}),
  ...(source ? { source } : { scenario }),
  ...(values.seed ? { seed: Number(values.seed) } : {}),
  ...(values.fps ? { fps: Number(values.fps) } : {}),
  faults: parseFaults(values.faults),
  log: (m) => console.log(m),
});

server.on("client", () => console.log("client connected"));
server.on("disconnect", (r) => console.log(`client disconnected (${r})`));
server.on("rejected", () => console.log("second client rejected (plugin accepts 1 client)"));
server.on("watchdog", (inputs) => console.log(`watchdog released: ${inputs.join(", ")}`));
server.on("bad", (e) => console.log(`bad frame from client: ${e}`));
server.on("recv", (m) => {
  if (m.t === "hb") return;
  if (values.verbose || m.t === "in") console.log("←", JSON.stringify(m));
});

await server.start();
console.log(
  `fake-pipe: ${values.replay ? `replay ${values.replay}` : `mock/${scenario}`}  faults=${JSON.stringify(server.faults)}`,
);

const statsTimer = setInterval(() => {
  if (!values.verbose) return;
  const s = server.stats;
  console.log(`stats: tel=${s.telSent} frames=${s.framesSent} hb=${s.hbReceived} in=${s.inReceived} held=[${s.held}]`);
}, 5000);

const shutdown = async () => {
  clearInterval(statsTimer);
  await server.stop();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
