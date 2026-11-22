import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Ajv } from "ajv";
import { afterEach, describe, expect, it } from "vitest";
import { HOLD_WATCHDOG_MS, IPC_VERSION, ipc } from "@yoga-auto/protocol";
import { isT, PipeTestClient } from "./client.ts";
import { FakePipeServer } from "./server.ts";
import { encodeFrame, FrameDecoder, testPipePath } from "./framing.ts";
import { parseFaults, type FaultSpec } from "./faults.ts";

const require = createRequire(import.meta.url);
const ajv = new Ajv({ allErrors: true, strict: false });
const fromPlugin = ajv.compile(
  JSON.parse(readFileSync(require.resolve("@yoga-auto/protocol/schema/ipc-from-plugin.schema.json"), "utf8")),
);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let servers: FakePipeServer[] = [];
let clients: PipeTestClient[] = [];

async function setup(faults: FaultSpec = {}, connect = true) {
  const server = new FakePipeServer({ path: testPipePath("fp"), scenario: "highway", faults });
  servers.push(server);
  await server.start();
  const client = new PipeTestClient(server.path);
  clients.push(client);
  if (connect) await client.connect();
  return { server, client };
}

afterEach(async () => {
  clients.forEach((c) => c.close());
  await Promise.all(servers.map((s) => s.stop()));
  servers = [];
  clients = [];
});

describe("framing", () => {
  it("decodes frames split across arbitrary chunks", () => {
    const a = encodeFrame({ t: "hb" });
    const b = encodeFrame({ t: "in", seq: 1, device: "semantical", input: "light", op: "press" });
    const all = Buffer.concat([a, b]);
    const d = new FrameDecoder();
    const out = [];
    for (let i = 0; i < all.length; i += 3) out.push(...d.push(all.subarray(i, i + 3)));
    expect(out.map((r) => r.ok && (r.msg as { t: string }).t)).toEqual(["hb", "in"]);
  });
  it("rejects oversize length and stops", () => {
    const head = Buffer.alloc(4);
    head.writeUInt32LE(ipc.IPC_MAX_FRAME_BYTES + 1);
    const d = new FrameDecoder();
    expect(d.push(head)).toEqual([{ ok: false, error: "too_large", bytes: 4, length: ipc.IPC_MAX_FRAME_BYTES + 1 }]);
    expect(d.push(encodeFrame({ t: "hb" }))).toEqual([]);
  });
  it("parses fault shorthand", () => {
    expect(parseFaults("drop:5000,garbage:0.1,stall:100/200,drop-acks,ipc:2,fragment")).toEqual({
      dropEveryMs: 5000,
      garbageRate: 0.1,
      stallAfterMs: 100,
      stallMs: 200,
      dropAcks: true,
      ipcVersion: 2,
      fragment: true,
    });
  });
});

describe("fake-pipe as a well-behaved plugin", () => {
  it("greets: hello → cfg → full tel, everything schema-valid", async () => {
    const { client } = await setup();
    await client.waitFor(isT("tel"), 2000, true);
    await sleep(200);
    const ts = client.received.map((m) => (m as { t: string }).t);
    expect(ts[0]).toBe("hello");
    expect(ts.indexOf("cfg")).toBeGreaterThan(0);
    const firstTel = client.received.find(isT("tel")) as ipc.IpcTelemetry;
    const hello = client.received[0] as ipc.IpcHello;
    expect(hello.ipc).toBe(IPC_VERSION);
    for (const name of hello.channels) expect(firstTel.ch, name).toHaveProperty([name]);
    for (const m of client.received) expect(fromPlugin(m), JSON.stringify(fromPlugin.errors)).toBe(true);
    expect(client.bad).toEqual([]);
  });

  it("accepts one client at a time", async () => {
    const { server } = await setup();
    const second = new PipeTestClient(server.path);
    clients.push(second);
    await second.connect().catch(() => {});
    await second.waitClose(2000);
    expect(server.stats.rejected).toBe(1);
  });

  it("press → in.ack ok and the simulated effect shows up in tel", async () => {
    const { client } = await setup();
    await client.waitFor(isT("tel"), 2000, true);
    client.send({ t: "in", seq: 5, device: "semantical", input: "light", op: "press" });
    const ack = await client.waitFor<ipc.IpcInputAck>((m) => isT("in.ack")(m) && (m as ipc.IpcInputAck).seq === 5);
    expect(ack.ok).toBe(true);
    const tel = await client.waitFor<ipc.IpcTelemetry>(
      (m) => isT("tel")(m) && (m as ipc.IpcTelemetry).ch["truck.light.parking"] === true,
    );
    expect(tel.ch["truck.light.parking"]).toBe(true);
  });

  it("unknown input → in.ack ok:false", async () => {
    const { client } = await setup();
    client.send({ t: "in", seq: 9, device: "semantical", input: "nope", op: "press" });
    const ack = await client.waitFor<ipc.IpcInputAck>(isT("in.ack"));
    expect(ack.ok).toBe(false);
  });

  it(
    "watchdog releases held inputs after HOLD_WATCHDOG_MS without hb",
    async () => {
      const { server, client } = await setup();
      client.send({ t: "in", seq: 1, device: "semantical", input: "horn", op: "down" });
      await sleep(300);
      expect(server.heldInputs()).toEqual(["horn"]);
      const t0 = Date.now();
      client.stopHeartbeat();
      const released = await new Promise<string[]>((r) => server.once("watchdog", r));
      expect(released).toEqual(["horn"]);
      expect(Date.now() - t0).toBeGreaterThanOrEqual(HOLD_WATCHDOG_MS - 300);
      expect(Date.now() - t0).toBeLessThan(HOLD_WATCHDOG_MS + 600);
      await client.waitFor((m) => isT("log")(m) && (m as ipc.IpcLog).msg.includes("watchdog"), 1000, true);
    },
    HOLD_WATCHDOG_MS + 3000,
  );

  it("hb keeps holds alive", async () => {
    const { server, client } = await setup();
    client.send({ t: "in", seq: 1, device: "semantical", input: "horn", op: "down" });
    await sleep(HOLD_WATCHDOG_MS + 500);
    expect(server.heldInputs()).toEqual(["horn"]);
    expect(server.stats.watchdogReleases).toBe(0);
  }, 8000);

  it("re-greets a reconnecting client with full state", async () => {
    const { server, client } = await setup();
    await client.waitFor(isT("tel"), 2000, true);
    server.drop();
    await client.waitClose();
    const c2 = new PipeTestClient(server.path);
    clients.push(c2);
    await c2.connect();
    await c2.waitFor(isT("hello"), 2000, true);
    const tel = await c2.waitFor<ipc.IpcTelemetry>(isT("tel"), 2000, true);
    expect(Object.keys(tel.ch).length).toBeGreaterThan(50);
  });
});

describe("fault modes", () => {
  it("dropEveryMs closes the connection", async () => {
    const { client } = await setup({ dropEveryMs: 300 });
    await client.waitClose(2000);
  });

  it("dropAfterFrames closes after N tel", async () => {
    const { client } = await setup({ dropAfterFrames: 5 });
    await client.waitClose(2000);
    expect(client.received.filter(isT("tel")).length).toBe(5);
  });

  it("garbage frames are injected (bad json / schema-invalid)", async () => {
    const { client, server } = await setup({ garbageRate: 0.5 });
    await sleep(500);
    expect(server.stats.garbageSent).toBeGreaterThan(5);
    const invalid = client.received.filter((m) => !fromPlugin(m)).length + client.bad.length;
    expect(invalid).toBeGreaterThan(5);
  });

  it("oversize frame header", async () => {
    const { client } = await setup({ oversizeAfterMs: 100 });
    await client.waitClose(2000);
    expect(client.bad.some((b) => b.error === "too_large")).toBe(true);
  });

  it("fragmented writes still decode", async () => {
    const { client } = await setup({ fragment: 3 });
    await client.waitFor(isT("tel"), 3000, true);
    expect(client.bad).toEqual([]);
    expect(client.received[0]).toMatchObject({ t: "hello" });
  });

  it("stall stops tel but keeps the connection", async () => {
    const { client } = await setup({ stallAfterMs: 200, stallMs: 600 });
    await sleep(300);
    const n = client.received.filter(isT("tel")).length;
    await sleep(300);
    expect(client.received.filter(isT("tel")).length).toBe(n);
    expect(client.closed).toBe(false);
    await sleep(500);
    expect(client.received.filter(isT("tel")).length).toBeGreaterThan(n);
  });

  it("dropAcks / ackDelayMs / ackFail", async () => {
    const { client, server } = await setup({ dropAcks: true });
    client.send({ t: "in", seq: 1, device: "semantical", input: "light", op: "press" });
    await expect(client.waitFor(isT("in.ack"), 400)).rejects.toThrow(/timeout/);
    server.setFaults({ ackDelayMs: 300 });
    const t0 = Date.now();
    client.send({ t: "in", seq: 2, device: "semantical", input: "light", op: "press" });
    await client.waitFor(isT("in.ack"), 1000);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(290);
    server.setFaults({ ackFail: true });
    client.send({ t: "in", seq: 3, device: "semantical", input: "light", op: "press" });
    expect(await client.waitFor<ipc.IpcInputAck>(isT("in.ack"))).toMatchObject({ seq: 3, ok: false });
  });

  it("ipcVersion override and inputDisabled", async () => {
    const { client } = await setup({ ipcVersion: 2, inputDisabled: true });
    const hello = await client.waitFor<ipc.IpcHello>(isT("hello"), 2000, true);
    expect(hello.ipc).toBe(2);
    expect(hello.inputEnabled).toBe(false);
    client.send({ t: "in", seq: 1, device: "semantical", input: "light", op: "press" });
    expect(await client.waitFor<ipc.IpcInputAck>(isT("in.ack"))).toMatchObject({ ok: false });
  });

  it("client sending an oversize frame gets dropped", async () => {
    const { client, server } = await setup();
    const head = Buffer.alloc(4);
    head.writeUInt32LE(ipc.IPC_MAX_FRAME_BYTES + 10);
    client.writeRaw(head);
    await client.waitClose(2000);
    expect(server.stats.badFramesReceived).toBe(1);
  });
});
