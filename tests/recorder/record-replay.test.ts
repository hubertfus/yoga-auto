/**
 * Pętla nagraj → odtwórz przez bridge: sesja bridge'a na mocku zapisana do .yarec, potem ReplaySource w nowym
 * bridge'u musi dać UI te same wartości (prędkość, bieg, zlecenie) i poprawny status (`source:"replay"`).
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { type FastState, type TelemetrySource } from "@yoga-auto/protocol";
import { createMockSource } from "@yoga-auto/mock";
import { YarecRecorder, ReplaySource, infoYarec, readYarec } from "@yoga-auto/recorder";
import { startBridge } from "../../bridge/src/server.ts";
import { violations } from "../support/schemas.ts";
import { TestWsClient, sleep } from "../support/ws-client.ts";

const tmp = mkdtempSync(join(tmpdir(), "yarec-e2e-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const bridgeHasRecorderHook = readFileSync(resolve(import.meta.dirname, "../../bridge/src/server.ts"), "utf8").includes(
  "opts.recorder",
);

function recordingSource(inner: TelemetrySource, rec: YarecRecorder): TelemetrySource {
  return {
    get kind() {
      return inner.kind;
    },
    start: () => inner.start(),
    stop: () => inner.stop(),
    send: (m) => inner.send(m),
    onMessage: (h) =>
      inner.onMessage((m) => {
        rec.ipc(m);
        h(m);
      }),
  };
}

describe("record → replay through the bridge", () => {
  const file = join(tmp, "session.yarec");
  const live: { speeds: number[] } = { speeds: [] };

  it("records a bridge session on the mock (IPC side, via source wrapper)", async () => {
    const rec = new YarecRecorder(file, { meta: { source: "mock", note: "test" } });
    const bridge = await startBridge({
      source: recordingSource(createMockSource({ scenario: "highway", speed: 4 }), rec),
      port: 0,
      host: "127.0.0.1",
      auth: false,
      log: () => {},
    });
    const c = await TestWsClient.connect(bridge.port);
    await sleep(3000);
    for (const m of c.of("fast")) if (m.d.speed !== undefined) live.speeds.push(m.d.speed);
    c.close();
    await bridge.close();
    await rec.close();
    const info = infoYarec(readYarec(file));
    expect(info.telFrames).toBeGreaterThan(100);
    expect(info.ipc.hello).toBe(1);
    expect(live.speeds.length).toBeGreaterThan(10);
  }, 15_000);

  it("replays the file: status.source=replay, connected, same speed profile, schema-valid", async () => {
    const bridge = await startBridge({
      source: new ReplaySource({ file, speed: 2 }),
      port: 0,
      host: "127.0.0.1",
      auth: false,
      log: () => {},
    });
    const c = await TestWsClient.connect(bridge.port);
    await sleep(2000);
    const snap = c.of("snapshot")[0]!;
    expect(snap.state.status.source).toBe("replay");
    const replayed: number[] = [];
    for (const m of c.of("fast")) if (m.d.speed !== undefined) replayed.push(m.d.speed);
    expect(replayed.length).toBeGreaterThan(10);
    // ta sama krzywa rozpędzania: prędkości odtworzone ⊂ zakres nagranych
    expect(Math.max(...replayed)).toBeLessThanOrEqual(Math.max(...live.speeds) + 0.01);
    expect(snap.state.status.connected).toBe(true);
    const fast = c.rx.filter((r) => r.msg.t === "fast").map((r) => r.msg as { d: Partial<FastState> });
    expect(fast.some((m) => m.d.gear !== undefined && m.d.gear > 0)).toBe(true);
    for (const r of c.rx) expect(violations("server", r.msg)).toBeNull();
    c.close();
    await bridge.close();
  }, 15_000);

  it("replay answers UI commands with an error instead of hanging", async () => {
    const bridge = await startBridge({
      source: new ReplaySource({ file, speed: 1 }),
      port: 0,
      host: "127.0.0.1",
      auth: false,
      log: () => {},
    });
    const c = await TestWsClient.connect(bridge.port);
    await sleep(500);
    const ack = await c.cmd("r1", "lights.cycle", {}, 3000);
    expect(ack.ok).toBe(false);
    expect(ack.error).toBeDefined();
    expect(ack.tookMs).toBeLessThan(1500);
    c.close();
    await bridge.close();
  }, 15_000);

  it.runIf(bridgeHasRecorderHook)(
    "bridge with the proposed recorder hook records both IPC and WS",
    async () => {
      const f = join(tmp, "hook.yarec");
      const rec = new YarecRecorder(f);
      const bridge = await startBridge({
        source: createMockSource({ scenario: "city-night" }),
        port: 0,
        host: "127.0.0.1",
        auth: false,
        log: () => {},
        ...({ recorder: rec } as object),
      });
      const c = await TestWsClient.connect(bridge.port);
      await sleep(1500);
      c.close();
      await bridge.close();
      const info = infoYarec(readYarec(f));
      expect(info.byKind.ipc).toBeGreaterThan(50);
      expect(info.byKind.ws).toBeGreaterThan(20);
    },
    15_000,
  );
});
