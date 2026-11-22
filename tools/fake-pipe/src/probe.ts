#!/usr/bin/env node
/**
 * probe — sprawdza PRAWDZIWY plugin (DLL S1 w grze) względem kontraktu, bez bridge'a.
 * Łączy się z `\\.\pipe\yoga-auto`, wysyła hb co 250 ms, waliduje każdą ramkę JSON Schema i kontroluje
 * zawartość handshake'u (hello → cfg → pełny tel).
 *
 *   node tools/fake-pipe/src/probe.ts [--path P] [--seconds 10] [--press light] [--json]
 *
 * Kod wyjścia: 0 = zgodny z kontraktem, 1 = naruszenia, 2 = nie udało się połączyć.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { parseArgs } from "node:util";
import { Ajv } from "ajv";
import { IPC_VERSION, PIPE_NAME, ipc } from "@yoga-auto/protocol";
import { PipeTestClient } from "./client.ts";

const { values } = parseArgs({
  options: {
    path: { type: "string", default: PIPE_NAME },
    seconds: { type: "string", default: "10" },
    press: { type: "string" },
    json: { type: "boolean", default: false },
  },
});

const require = createRequire(import.meta.url);
const ajv = new Ajv({ allErrors: true, strict: false });
const validate = ajv.compile(
  JSON.parse(readFileSync(require.resolve("@yoga-auto/protocol/schema/ipc-from-plugin.schema.json"), "utf8")),
);

const client = new PipeTestClient(values.path);
const problems: string[] = [];
const counts: Record<string, number> = {};
const order: string[] = [];
let hello: ipc.IpcHello | null = null;
let firstTel: ipc.IpcTelemetry | null = null;
let lastFrame = -1;
let telCount = 0;
const t0 = performance.now();
let ackSeen = false;

try {
  await client.connect();
} catch (e) {
  console.error(`probe: cannot connect to ${values.path}: ${String(e)}`);
  process.exit(2);
}

client.on("msg", (m) => {
  const msg = m as { t?: string };
  const t = msg?.t ?? "?";
  counts[t] = (counts[t] ?? 0) + 1;
  if (!order.includes(t)) order.push(t);
  if (!validate(m)) problems.push(`${t}: ${ajv.errorsText(validate.errors, { separator: "; " }).slice(0, 200)}`);
  if (t === "hello") hello = m as ipc.IpcHello;
  if (t === "tel") {
    const tel = m as ipc.IpcTelemetry;
    telCount++;
    firstTel ??= tel;
    if (tel.frame < lastFrame) problems.push(`tel.frame went backwards: ${lastFrame} → ${tel.frame}`);
    lastFrame = tel.frame;
  }
  if (t === "in.ack") ackSeen = true;
});
client.on("bad", (b) => problems.push(`bad frame from plugin: ${b.error}`));

if (values.press)
  setTimeout(() => client.send({ t: "in", seq: 1, device: "semantical", input: values.press!, op: "press" }), 1500);
await new Promise((r) => setTimeout(r, Number(values.seconds) * 1000));
client.close();

// ── zawartość handshake'u ──
const h = hello as ipc.IpcHello | null;
if (!h) problems.push("no hello received");
else {
  if (h.ipc !== IPC_VERSION) problems.push(`hello.ipc=${h.ipc}, expected ${IPC_VERSION}`);
  const wanted = new Set<string>();
  for (const c of ipc.PLUGIN_CHANNELS)
    if (c.idx) for (let i = 0; i < c.idx; i++) wanted.add(c.name.replace("{i}", String(i)));
    else wanted.add(c.name);
  const have = new Set(h.channels);
  const missing = [...wanted].filter((n) => !have.has(n));
  const extra = [...have].filter((n) => !wanted.has(n));
  if (extra.length) problems.push(`hello.channels has names outside PLUGIN_CHANNELS: ${extra.slice(0, 5).join(", ")}`);
  if (missing.length)
    console.log(
      `note: ${missing.length} PLUGIN_CHANNELS not registered by this game version: ${missing.slice(0, 8).join(", ")}${missing.length > 8 ? "…" : ""}`,
    );
  const ft = firstTel as ipc.IpcTelemetry | null;
  if (ft) {
    const absent = h.channels.filter((n) => !(n in ft.ch));
    if (absent.length)
      problems.push(
        `first tel lacks ${absent.length} registered channels (full set required): ${absent.slice(0, 5).join(", ")}`,
      );
  } else problems.push("no tel received");
}
if (order[0] !== "hello") problems.push(`first message was "${order[0]}", expected hello`);
if (values.press && !ackSeen) problems.push(`sent press ${values.press} but got no in.ack`);

const secs = (performance.now() - t0) / 1000;
const report = {
  path: values.path,
  seconds: Math.round(secs),
  counts,
  telHz: Math.round(telCount / secs),
  game: h?.game,
  api: h?.api,
  problems,
};
if (values.json) console.log(JSON.stringify(report, null, 2));
else {
  console.log(`probe ${values.path}  ${report.seconds}s  ${JSON.stringify(counts)}  ~${report.telHz} tel/s`);
  if (h)
    console.log(
      `game ${h.game.name} ${h.game.version}  api telemetry ${h.api.telemetry} input ${h.api.input}  ${h.channels.length} channels`,
    );
  console.log(
    problems.length
      ? `PROBLEMS (${problems.length}):\n  ${problems.slice(0, 20).join("\n  ")}`
      : "OK: plugin conforms to IPC v1",
  );
}
process.exit(problems.length ? 1 : 0);
