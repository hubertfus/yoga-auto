/**
 * PipeSource (bridge/src/sources/pipe.ts, S2) kontra fake-pipe (tools/fake-pipe, S7):
 * każdy tryb awarii z briefu S7 — zrywanie połączenia, śmieciowe ramki, ramka > limit, brak hb —
 * plus reconnect, hb, round-trip `in`/`in.ack`.
 *
 * Testy oznaczone `knownBug` opisują błędy znalezione w PipeSource/bridge'u (docs/proposals/s7-bug-*.md);
 * po poprawce zamień `knownBug` na `it`.
 */
import { afterEach, describe, expect, it } from "vitest";
import { type SourceMsg, ipc } from "@yoga-auto/protocol";
import { FakePipeServer, testPipePath, type FaultSpec } from "@yoga-auto/fake-pipe";
import { PipeSource } from "../../bridge/src/sources/pipe.ts";
import { knownBug } from "../support/known-bug.ts";
import { violations } from "../support/schemas.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Rig {
  server: FakePipeServer;
  source: PipeSource;
  msgs: SourceMsg[];
  handlerErrors: unknown[];
  of<T extends SourceMsg["t"]>(t: T): Extract<SourceMsg, { t: T }>[];
  waitFor(pred: (m: SourceMsg) => boolean, ms?: number): Promise<SourceMsg>;
}

let servers: FakePipeServer[] = [];
let sources: PipeSource[] = [];

async function rig(faults: FaultSpec = {}, opts: { startServer?: boolean } = {}): Promise<Rig> {
  const server = new FakePipeServer({ path: testPipePath("ps"), scenario: "highway", faults });
  servers.push(server);
  const source = new PipeSource(server.path);
  sources.push(source);
  const msgs: SourceMsg[] = [];
  const handlerErrors: unknown[] = [];
  source.onMessage((m) => {
    msgs.push(m);
  });
  if (opts.startServer !== false) await server.start();
  await source.start();
  return {
    server,
    source,
    msgs,
    handlerErrors,
    of: (t) => msgs.filter((m) => m !== null && typeof m === "object" && m.t === t) as never,
    waitFor: async (pred, ms = 3000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        const hit = msgs.find((m) => m !== null && typeof m === "object" && pred(m));
        if (hit) return hit;
        await sleep(10);
      }
      throw new Error(`waitFor timeout after ${ms} ms; got ${msgs.map((m) => (m as { t?: string })?.t).slice(-8)}`);
    },
  };
}

afterEach(async () => {
  await Promise.all(sources.map((s) => s.stop()));
  await Promise.all(servers.map((s) => s.stop()));
  sources = [];
  servers = [];
});

describe("PipeSource ↔ fake-pipe: happy path", () => {
  it("emits connected → hello → cfg → tel, all schema-valid", async () => {
    const r = await rig();
    await r.waitFor((m) => m.t === "tel");
    await sleep(200);
    expect(r.msgs[0]).toEqual({ t: "connected" });
    expect(r.msgs[1]!.t).toBe("hello");
    expect(r.msgs.findIndex((m) => m.t === "cfg")).toBeGreaterThan(1);
    for (const m of r.msgs) {
      if (m.t === "connected" || m.t === "disconnected") continue;
      expect(violations("fromPlugin", m), JSON.stringify(m).slice(0, 120)).toBeNull();
    }
  });

  it("sends hb about every 250 ms", async () => {
    const r = await rig();
    await sleep(1300);
    const hb = r.server.stats.hbReceived;
    expect(hb).toBeGreaterThanOrEqual(4);
    expect(hb).toBeLessThanOrEqual(7);
  });

  it("in → in.ack round trip changes the simulated state", async () => {
    const r = await rig();
    await r.waitFor((m) => m.t === "tel");
    r.source.send({ t: "in", seq: 11, device: "semantical", input: "light", op: "press" });
    const ack = (await r.waitFor((m) => m.t === "in.ack" && m.seq === 11)) as ipc.IpcInputAck;
    expect(ack.ok).toBe(true);
    await r.waitFor((m) => m.t === "tel" && m.ch["truck.light.parking"] === true);
  });

  it("send() while disconnected is a silent no-op", async () => {
    const r = await rig({}, { startServer: false });
    expect(() => r.source.send({ t: "in", seq: 1, device: "semantical", input: "light", op: "press" })).not.toThrow();
  });
});

describe("failure mode: connection drops / plugin absent", () => {
  it("emits disconnected on drop and reconnects within ~1.5 s with a fresh hello", async () => {
    const r = await rig();
    await r.waitFor((m) => m.t === "tel");
    const t0 = Date.now();
    r.server.drop();
    await r.waitFor((m) => m.t === "disconnected");
    await r.waitFor((m) => m.t === "connected" && r.msgs.indexOf(m) > r.msgs.findIndex((x) => x.t === "disconnected"));
    expect(Date.now() - t0).toBeLessThan(2000);
    await sleep(300);
    expect(r.of("hello").length).toBe(2);
  });

  it("keeps retrying when the plugin is not there yet and connects once it appears", async () => {
    const r = await rig({}, { startServer: false });
    await sleep(1500); // kilka nieudanych prób
    expect(r.msgs.filter((m) => m.t === "connected").length).toBe(0);
    await r.server.start();
    await r.waitFor((m) => m.t === "tel", 3000);
  });

  it("reconnects through repeated drops (dropEveryMs)", async () => {
    const r = await rig({ dropEveryMs: 600 });
    await sleep(5500);
    expect(r.server.stats.connections).toBeGreaterThanOrEqual(3);
    expect(r.of("disconnected").length).toBeGreaterThanOrEqual(2);
  }, 10_000);

  it("stop() ends reconnecting for good and sends no further hb", async () => {
    const r = await rig();
    await r.waitFor((m) => m.t === "tel");
    await r.source.stop();
    const conns = r.server.stats.connections;
    const hb = r.server.stats.hbReceived;
    await sleep(1600);
    expect(r.server.stats.connections).toBe(conns);
    expect(r.server.stats.hbReceived).toBe(hb);
  });
});

describe("failure mode: garbage frames", () => {
  it("survives unparseable frames (not-json, invalid-utf8, empty) and keeps streaming", async () => {
    const r = await rig({ garbageRate: 0.3, garbageKinds: ["not-json", "invalid-utf8", "empty"] });
    await sleep(800);
    expect(r.server.stats.garbageSent).toBeGreaterThan(5);
    expect(r.of("tel").length).toBeGreaterThan(10);
    expect(r.of("disconnected")).toEqual([]);
    expect(r.of("log").some((l) => l.level === "warn" && /bad frame/.test(l.msg))).toBe(true);
  });

  it("survives and ignores unknown message types", async () => {
    const r = await rig({ garbageRate: 0.3, garbageKinds: ["unknown-t"] });
    await sleep(500);
    expect(r.of("tel").length).toBeGreaterThan(10);
    expect(r.of("disconnected")).toEqual([]);
  });

  knownBug(
    "non-object JSON frames (null, [..], 42, object without `t`) must not reach handlers as SourceMsg",
    "docs/proposals/s7-bug-pipe-nonobject-frame.md",
    async () => {
      const r = await rig({ garbageRate: 0.3, garbageKinds: ["null", "array", "number", "no-t"] });
      await sleep(600);
      const leaked = r.msgs.filter(
        (m) => m === null || typeof m !== "object" || typeof (m as { t?: unknown }).t !== "string",
      );
      expect(
        leaked.length,
        `${leaked.length} malformed messages leaked to handlers: ${JSON.stringify(leaked.slice(0, 3))}`,
      ).toBe(0);
    },
  );

  knownBug(
    "schema-invalid but well-formed frames (tel with ch:null, cfg with attrs:'oops') must be dropped, not delivered",
    "docs/proposals/s7-bug-pipe-nonobject-frame.md",
    async () => {
      const r = await rig({ garbageRate: 0.3, garbageKinds: ["bad-tel", "bad-cfg"] });
      await sleep(600);
      const bad = r.msgs.filter((m) => m.t === "tel" && (m.ch === null || typeof m.frame !== "number"));
      expect(bad.length).toBe(0);
      const badCfg = r.msgs.filter((m) => m.t === "cfg" && m.attrs !== null && typeof m.attrs !== "object");
      expect(badCfg.length).toBe(0);
    },
  );
});

describe("failure mode: oversize frame / fragmentation", () => {
  it("drops the connection on a frame longer than IPC_MAX_FRAME_BYTES and reconnects", async () => {
    const r = await rig({ oversizeAfterMs: 200 });
    await r.waitFor((m) => m.t === "tel");
    await r.waitFor((m) => m.t === "disconnected", 2000);
    expect(r.of("log").some((l) => l.level === "error" && /too large/.test(l.msg))).toBe(true);
    await r.waitFor(
      (m) => m.t === "connected" && r.msgs.indexOf(m) > r.msgs.findIndex((x) => x.t === "disconnected"),
      3000,
    );
  });

  it("reassembles frames written in tiny fragments", async () => {
    const r = await rig({ fragment: 3 });
    await r.waitFor((m) => m.t === "tel", 5000);
    expect(r.of("log").filter((l) => /bad frame/.test(l.msg))).toEqual([]);
    expect(r.msgs[1]!.t).toBe("hello");
  });
});

describe("failure mode: no heartbeat (plugin watchdog)", () => {
  it("while PipeSource is alive its hb keeps holds from being released by the plugin watchdog", async () => {
    const r = await rig();
    await r.waitFor((m) => m.t === "tel");
    r.source.send({ t: "in", seq: 1, device: "semantical", input: "horn", op: "down" });
    await sleep(3600);
    expect(r.server.heldInputs()).toEqual(["horn"]);
    expect(r.server.stats.watchdogReleases).toBe(0);
  }, 8000);
});

describe("failure mode: plugin misbehaviour at the protocol level", () => {
  it("accepts a hello with a different ipc version and tells the bridge about it (so it can refuse)", async () => {
    const r = await rig({ ipcVersion: 2 });
    const hello = (await r.waitFor((m) => m.t === "hello")) as ipc.IpcHello;
    expect(hello.ipc).toBe(2); // PipeSource przekazuje dalej; decyzja należy do bridge'a — patrz bugs/bridge-process.test.ts
  });
});
