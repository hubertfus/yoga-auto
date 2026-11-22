/**
 * Test kontraktu przekrojowego: bridge na MockSource przez CONTRACT_SECONDS (domyślnie 30 s), po jednym
 * bridge'u na scenariusz, równolegle. Sprawdza, że:
 *  - KAŻDA wiadomość WS bridge → UI jest zgodna z JSON Schema (server-msg),
 *  - KAŻDA wiadomość źródła (mock → bridge) jest zgodna z ipc-from-plugin, a każda wiadomość
 *    bridge → źródło z ipc-to-plugin,
 *  - kolejność i sekwencje (hello → snapshot, rosnące seq, ts, echo pong, ack dla każdej komendy),
 *  - bridge nie pada na śmieciach od klienta (zły JSON, nieznany typ, nieznana akcja).
 *
 * Skrócenie lokalnie: CONTRACT_SECONDS=8 npx vitest run tests/contract/bridge-mock
 */
import { describe, expect, it } from "vitest";
import { ACTIONS, type ActionId, type ServerMsg, type SourceMsg, type TelemetrySource, ipc } from "@yoga-auto/protocol";
import { MOCK_SCENARIOS, createMockSource, type MockScenario } from "@yoga-auto/mock";
import { startBridge } from "../../bridge/src/server.ts";
import { violations } from "../support/schemas.ts";
import { TestWsClient, sleep } from "../support/ws-client.ts";

const SECONDS = Number(process.env.CONTRACT_SECONDS ?? 30);

interface Spy {
  source: TelemetrySource;
  fromSource: SourceMsg[];
  toSource: ipc.IpcToPlugin[];
}

function spy(inner: TelemetrySource): Spy {
  const fromSource: SourceMsg[] = [];
  const toSource: ipc.IpcToPlugin[] = [];
  const source: TelemetrySource = {
    get kind() {
      return inner.kind;
    },
    start: () => inner.start(),
    stop: () => inner.stop(),
    send(m) {
      toSource.push(m);
      inner.send(m);
    },
    onMessage(h) {
      return inner.onMessage((m) => {
        fromSource.push(m);
        h(m);
      });
    },
  };
  return { source, fromSource, toSource };
}

const PRESS_ACTIONS: ActionId[] = [
  "lights.cycle",
  "blinker.left",
  "blinker.right",
  "lights.hazard",
  "cruise.set",
  "parkingBrake.toggle",
];

interface Result {
  scenario: MockScenario;
  client: TestWsClient;
  spy: Spy;
  acks: Map<string, ServerMsg & { t: "ack" }>;
  pongs: number;
  sent: Record<string, number>;
}

async function runScenario(scenario: MockScenario, seconds: number): Promise<Result> {
  const sp = spy(createMockSource({ scenario, speed: scenario === "job-cycle" ? 3 : 1 }));
  const bridge = await startBridge({ source: sp.source, port: 0, host: "127.0.0.1", auth: false, log: () => {} });
  const client = await TestWsClient.connect(bridge.port);
  const sent: Record<string, number> = {};
  const note = (k: string) => (sent[k] = (sent[k] ?? 0) + 1);
  let pongs = 0;
  const acks = new Map<string, ServerMsg & { t: "ack" }>();

  client.send({ t: "subscribe", fastHz: 60, placement: true });
  const t0 = performance.now();
  let tick = 0;
  let id = 0;
  while (performance.now() - t0 < seconds * 1000) {
    await sleep(100);
    tick++;
    if (tick % 10 === 0) {
      client.send({ t: "ping", t0: performance.now() });
      note("ping");
    }
    if (tick % 17 === 3) {
      const a = PRESS_ACTIONS[Math.floor(tick / 17) % PRESS_ACTIONS.length] ?? "lights.cycle";
      const cid = `p${++id}`;
      client.send({ t: "cmd", id: cid, action: a });
      note("cmd.press");
    }
    if (tick === 20) {
      // hold: down → keep → up
      for (const [n, op] of [
        ["h1", "down"],
        ["h2", "keep"],
        ["h3", "up"],
      ] as const) {
        client.send({ t: "cmd", id: n, action: "horn", op });
        note("cmd.hold");
        await sleep(100);
      }
    }
    if (tick === 25) {
      client.send({ t: "cmd", id: "unk", action: "warp.drive" });
      note("cmd.unknown");
    }
    if (tick === 30) client.send({ t: "resync" });
    if (tick === 35) client.send({ t: "trip.reset", id: "tr1" });
    if (tick === 40) {
      client.sendRaw("{ not json");
      client.send({ t: "totally.new.message", x: 1 });
      client.sendRaw("[1,2]");
      client.sendRaw('"str"');
      client.sendRaw("42");
      // `null` zabija bridge: docs/proposals/s7-bug-ws-null-frame.md, test w tests/bugs/*
    }
    if (tick === 45) client.send({ t: "subscribe", fastHz: 30, placement: false });
  }
  await sleep(300);
  for (const a of client.of("ack")) acks.set(a.id, a);
  pongs = client.of("pong").length;
  const result: Result = { scenario, client, spy: sp, acks, pongs, sent };
  client.close();
  await bridge.close();
  return result;
}

describe(`bridge on mock for ${SECONDS} s (all scenarios in parallel)`, async () => {
  const results = new Map<MockScenario, Result>();
  it(
    "runs",
    async () => {
      const all = await Promise.all(MOCK_SCENARIOS.map((s) => runScenario(s, SECONDS)));
      for (const r of all) results.set(r.scenario, r);
    },
    SECONDS * 1000 + 20_000,
  );

  for (const scenario of MOCK_SCENARIOS) {
    describe(scenario, () => {
      const r = () => results.get(scenario)!;

      it("every WS message from the bridge matches server-msg schema", () => {
        const bad: string[] = [];
        for (const rx of r().client.rx) {
          const v = violations("server", rx.msg);
          if (v) bad.push(v);
        }
        expect(r().client.invalid, "non-JSON frames from bridge").toEqual([]);
        expect(bad.slice(0, 5), `${bad.length} violations of ${r().client.rx.length} messages`).toEqual([]);
        expect(r().client.rx.length).toBeGreaterThan(SECONDS * 10);
      });

      it("every source message matches ipc-from-plugin (excluding connection events)", () => {
        const bad: string[] = [];
        for (const m of r().spy.fromSource) {
          if (m.t === "connected" || m.t === "disconnected") continue;
          const v = violations("fromPlugin", m);
          if (v) bad.push(v);
        }
        expect(bad.slice(0, 5)).toEqual([]);
        expect(r().spy.fromSource.filter((m) => m.t === "tel").length).toBeGreaterThan(SECONDS * 30);
      });

      it("every bridge → source message matches ipc-to-plugin", () => {
        const sent = r().spy.toSource;
        const bad = sent.map((m) => violations("toPlugin", m)).filter(Boolean);
        expect(bad.slice(0, 5)).toEqual([]);
        // hb co 250 ms byłoby od PipeSource; przy mocku bridge wysyła tylko `in`
        expect(sent.some((m) => m.t === "in")).toBe(true);
      });

      it("hello then snapshot first, ts plausible, seq strictly increasing", () => {
        const rx = r().client.rx;
        expect(rx[0]!.msg.t).toBe("hello");
        expect(rx[1]!.msg.t).toBe("snapshot");
        let last = -1;
        const seqd = rx.filter((x) => "seq" in x.msg && x.msg.t !== "snapshot");
        for (const x of seqd) {
          const seq = (x.msg as { seq: number }).seq;
          expect(seq, `${x.msg.t} seq ${seq} after ${last}`).toBeGreaterThan(last);
          last = seq;
        }
        for (const x of rx) {
          const ts = (x.msg as { ts?: number }).ts;
          if (ts !== undefined) expect(Math.abs(ts - x.wall), `${x.msg.t} ts skew`).toBeLessThan(2000);
        }
      });

      it("pongs echo t0; every cmd gets exactly one ack with a legal outcome", () => {
        expect(r().pongs).toBeGreaterThanOrEqual(Math.floor(SECONDS) - 2);
        const acks = [...r().acks.values()];
        for (const a of acks) {
          if (a.id === "unk") expect(a).toMatchObject({ ok: false, error: "unknown_action" });
          else if (a.id.startsWith("h")) expect(a, JSON.stringify(a)).toMatchObject({ ok: true });
          else expect(typeof a.ok).toBe("boolean");
        }
        const ids = r()
          .client.of("ack")
          .map((a) => a.id);
        expect(new Set(ids).size, "duplicate acks").toBe(ids.length);
        const expected = (r().sent["cmd.press"] ?? 0) + (r().sent["cmd.hold"] ?? 0) + (r().sent["cmd.unknown"] ?? 0);
        expect(ids.length).toBe(expected);
      });

      it("only press/hold-capable actions were mapped to inputs known to the catalog", () => {
        const known = new Set(
          Object.values(ACTIONS).flatMap((a) => ([] as string[]).concat(a.scs as string | string[])),
        );
        for (const m of r().spy.toSource) if (m.t === "in") expect(known.has(m.input), m.input).toBe(true);
      });
    });
  }

  // job-cycle działa z x3: dostarczenie po ~20 s zegara ściennego
  it.runIf(SECONDS >= 25)("job-cycle delivers a job.delivered event to the UI", () => {
    const ev = results.get("job-cycle")!.client.of("event");
    expect(ev.some((e) => e.event.kind === "job.delivered")).toBe(true);
  });
});
