import { afterEach, describe, expect, it } from "vitest";
import { createMockSource } from "@yoga-auto/mock";
import { WsCloseCode } from "@yoga-auto/protocol";
import { startBridge } from "../src/server.ts";
import { TestClient, sleep } from "./ws-client.ts";

type Bridge = Awaited<ReturnType<typeof startBridge>>;
const open: { close(): unknown }[] = [];
afterEach(async () => {
  for (const o of open.splice(0).reverse()) await o.close();
});

async function boot(scenario: "highway" | "city-night" = "highway"): Promise<Bridge> {
  const b = await startBridge({
    source: createMockSource({ scenario }),
    port: 0,
    host: "127.0.0.1",
    auth: false,
    log: () => {},
  });
  open.push(b);
  return b;
}

async function connect(b: Bridge): Promise<TestClient> {
  const c = new TestClient(b.port);
  open.push(c);
  await c.opened();
  await c.next("snapshot");
  return c;
}

describe("bridge + mock przez WS", () => {
  it("hello → snapshot → fast/slow z seq per klient bez dziur", async () => {
    const b = await boot();
    const c = await connect(b);
    await sleep(1200);
    const seqd = c.msgs.filter((m): m is Extract<typeof m, { seq: number }> => "seq" in m && m.t !== "snapshot");
    expect(seqd.length).toBeGreaterThan(20);
    const snapSeq = (c.msgs.find((m) => m.t === "snapshot") as { seq: number }).seq;
    seqd.reduce((prev, m) => {
      expect(m.seq).toBe(prev + 1);
      return m.seq;
    }, snapSeq);
  });

  it("set lights.mode w pętli zamkniętej na mocku", async () => {
    const b = await boot();
    const c = await connect(b);
    await sleep(300);
    const a = await c.cmd({ id: "s1", action: "lights.mode", value: "low" });
    expect(a).toMatchObject({ ok: true, state: "low" });
    expect(b.store.state.fast.lights.low).toBe(true);
    const a2 = await c.cmd({ id: "s2", action: "lights.mode", value: "off" });
    expect(a2).toMatchObject({ ok: true, state: "off" });
    expect(b.store.state.fast.lights.parking).toBe(false);
    const r = await c.cmd({ id: "s3", action: "retarder.level", value: "2" });
    expect(r).toMatchObject({ ok: true, state: "2" });
  });

  it("klienci 15 Hz i 60 Hz widzą ten sam stan końcowy", async () => {
    const b = await boot();
    const slow = await connect(b);
    const fast = await connect(b);
    slow.send({ t: "subscribe", fastHz: 15 });
    fast.send({ t: "subscribe", fastHz: 60 });
    await sleep(500);
    await slow.cmd({ id: "x", action: "lights.hazard" });
    await sleep(600);
    const last = (c: TestClient) =>
      [...c.msgs].reverse().find((m) => m.t === "fast" && m.d.hazard !== undefined) as { d: { hazard: boolean } };
    expect(last(slow).d.hazard).toBe(true);
    expect(last(fast).d.hazard).toBe(true);
    const n = (c: TestClient) => c.msgs.filter((m) => m.t === "fast").length;
    expect(n(fast)).toBeGreaterThan(n(slow));
  });

  it("rate limit: >20 komend/s → rate_limited, flood → zamknięcie 4008", async () => {
    const b = await boot();
    const c = await connect(b);
    for (let i = 0; i < 30; i++) c.send({ t: "cmd", id: `r${i}`, action: "camera.cycle" });
    await sleep(400);
    const acks = c.msgs.filter((m) => m.t === "ack");
    expect(acks.some((a) => a.t === "ack" && a.error === "rate_limited")).toBe(true);
    for (let i = 0; i < 200; i++) c.send({ t: "cmd", id: `f${i}`, action: "camera.cycle" });
    expect(await c.closed()).toBe(WsCloseCode.RateLimited);
  });

  it("rozłączenie ostatniego klienta z trzymanym klaksonem: up + releaseAll do pluginu", async () => {
    const source = createMockSource();
    const sent: { t: string; op?: string; input?: string }[] = [];
    const orig = source.send.bind(source);
    source.send = (m) => {
      sent.push(m as never);
      orig(m);
    };
    const b = await startBridge({ source, port: 0, host: "127.0.0.1", auth: false, log: () => {} });
    open.push(b);
    const c = await connect(b);
    expect((await c.cmd({ id: "h1", action: "horn", op: "down" })).ok).toBe(true);
    expect(sent.some((m) => m.t === "in" && m.op === "down" && m.input === "horn")).toBe(true);
    c.close();
    await sleep(200);
    expect(sent.some((m) => m.t === "in" && m.op === "up" && m.input === "horn")).toBe(true);
    expect(sent.some((m) => m.t === "releaseAll")).toBe(true);
  });
});
