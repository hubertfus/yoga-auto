/** Smoke test łańcucha: MockSource → bridge → WS → cmd → ack. Uruchom: node scripts/smoke.ts */
import { WebSocket } from "ws";
import { WS_SUBPROTOCOL, type ServerMsg } from "@yoga-auto/protocol";
import { createMockSource } from "@yoga-auto/mock";
import { startBridge } from "../bridge/src/server.ts";

const bridge = await startBridge({
  source: createMockSource({ scenario: "city-night", speed: 4 }),
  port: 0,
  host: "127.0.0.1",
  auth: false,
  log: () => {},
});
const ws = new WebSocket(`ws://127.0.0.1:${bridge.port}/ws`, [WS_SUBPROTOCOL]);
const counts: Record<string, number> = {};
let lights: unknown = null;
let ack: unknown = null;
let maxSpeed = 0;
ws.on("message", (d) => {
  const m = JSON.parse(String(d)) as ServerMsg;
  counts[m.t] = (counts[m.t] ?? 0) + 1;
  if (m.t === "fast" && m.d.lights) lights = m.d.lights;
  if (m.t === "fast" && m.d.speed !== undefined) maxSpeed = Math.max(maxSpeed, m.d.speed * 3.6);
  if (m.t === "snapshot") lights = m.state.fast.lights;
  if (m.t === "ack") ack = m;
});
await new Promise((r) => ws.on("open", r));
await new Promise((r) => setTimeout(r, 1500));
const before = JSON.stringify(lights);
ws.send(JSON.stringify({ t: "cmd", id: "smoke1", action: "lights.cycle" }));
await new Promise((r) => setTimeout(r, 1500));
console.log(
  JSON.stringify(
    { counts, maxSpeedKmh: Math.round(maxSpeed), lightsBefore: JSON.parse(before), lightsAfter: lights, ack },
    null,
    1,
  ),
);
const ok =
  (counts.fast ?? 0) > 40 &&
  (counts.slow ?? 0) >= 4 &&
  counts.hello === 1 &&
  (ack as { ok?: boolean })?.ok === true &&
  before !== JSON.stringify(lights);
console.log(ok ? "SMOKE OK" : "SMOKE FAIL");
ws.close();
await bridge.close();
process.exit(ok ? 0 : 1);
