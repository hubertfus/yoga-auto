/**
 * Poprawki zgłoszone przez S7: zła ramka WS/pipe nie zabija bridge'a, sprawdzenie `hello.ipc`,
 * hook rekordera. Źródło testowe = ręcznie sterowany `TelemetrySource`.
 */
import { createServer, type Server, type Socket } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { IPC_VERSION, type ServerMsg, type SourceMsg, type TelemetrySource, type ipc } from "@yoga-auto/protocol";
import { isClientFrame, isIpcFromPlugin } from "../src/guards.ts";
import { startBridge, type Recorder } from "../src/server.ts";
import { PipeSource } from "../src/sources/pipe.ts";
import { allInputs } from "./simsource.ts";
import { TestClient, sleep } from "./ws-client.ts";

class ManualSource implements TelemetrySource {
  readonly kind = "pipe" as const;
  readonly sent: ipc.IpcToPlugin[] = [];
  private h = new Set<(m: SourceMsg) => void>();
  async start() {}
  async stop() {}
  send(m: ipc.IpcToPlugin) {
    this.sent.push(m);
  }
  onMessage(h: (m: SourceMsg) => void) {
    this.h.add(h);
    return () => this.h.delete(h);
  }
  emit(m: SourceMsg) {
    this.h.forEach((h) => h(m));
  }
}

const hello = (ipcVersion: number): ipc.IpcHello => ({
  t: "hello",
  ipc: ipcVersion,
  plugin: { name: "yoga-auto", version: "0.0.1" },
  game: { id: "eut2", name: "Euro Truck Simulator 2", version: "1.50" },
  api: { telemetry: "1.18", input: "1.0" },
  channels: [],
  inputs: allInputs(),
  inputEnabled: true,
});
const tel = (ch: Record<string, number>, frame = 1): ipc.IpcTelemetry => ({
  t: "tel",
  frame,
  simTime: 0,
  renderTime: 0,
  paused: false,
  ch,
});

const open: { close(): unknown }[] = [];
afterEach(async () => {
  for (const o of open.splice(0).reverse()) await o.close();
});

async function boot(source: TelemetrySource, extra: Partial<Parameters<typeof startBridge>[0]> = {}) {
  const b = await startBridge({ source, port: 0, host: "127.0.0.1", auth: false, log: () => {}, ...extra });
  open.push(b);
  return b;
}
async function connect(port: number) {
  const c = new TestClient(port);
  open.push(c);
  await c.opened();
  await c.next("snapshot");
  return c;
}

describe("guardy kształtu", () => {
  it("isClientFrame", () => {
    for (const bad of [null, undefined, 42, "x", [], [1], {}, { t: 1 }]) expect(isClientFrame(bad)).toBe(false);
    expect(isClientFrame({ t: "ping" })).toBe(true);
  });
  it("isIpcFromPlugin odrzuca śmieci i akceptuje poprawne ramki", () => {
    for (const bad of [null, [], 42, {}, { t: "nope" }, { t: "tel", ch: null }, { t: "tel", ch: {}, frame: 1 }])
      expect(isIpcFromPlugin(bad)).toBe(false);
    expect(isIpcFromPlugin({ t: "cfg", id: "job", attrs: "oops" })).toBe(false);
    expect(isIpcFromPlugin({ t: "in.ack", seq: "1", ok: true })).toBe(false);
    expect(isIpcFromPlugin(hello(1))).toBe(true);
    expect(isIpcFromPlugin(tel({ "truck.speed": 1 }))).toBe(true);
    expect(isIpcFromPlugin({ t: "cfg", id: "job", attrs: null })).toBe(true);
    expect(isIpcFromPlugin({ t: "log", level: "info", msg: "x" })).toBe(true);
  });
});

describe("ramki WS (s7-bug-ws-null-frame)", () => {
  it("null/tablica/liczba/obiekt bez t/zły JSON nie ubijają bridge'a ani połączenia", async () => {
    const b = await boot(new ManualSource());
    const c = await connect(b.port);
    for (const raw of ["null", "[1,2,3]", "42", '"str"', "{}", '{"t":5}', "{nie json"]) c.ws.send(raw);
    c.send({ t: "ping", t0: 7 });
    const pong = await c.next("pong");
    expect(pong.t0).toBe(7);
  });

  it("wyjątek handlera modułu jest logowany, a nie rzucany (unhandled rejection)", async () => {
    const errors: string[] = [];
    const rejections: unknown[] = [];
    const onRej = (e: unknown) => rejections.push(e);
    process.on("unhandledRejection", onRej);
    try {
      const b = await boot(new ManualSource(), {
        log: (l, m) => {
          if (l === "error") errors.push(m);
        },
        modules: [
          {
            name: "boom",
            capability: "media",
            async start(ctx) {
              ctx.onClientMsg("media", async () => {
                throw new Error("kaboom");
              });
            },
            async stop() {},
          },
        ],
      });
      const c = await connect(b.port);
      c.send({ t: "media", id: "m1", op: "play" } as never);
      await sleep(100);
      c.send({ t: "ping", t0: 1 });
      await c.next("pong");
      await sleep(50);
      expect(errors.some((e) => e.includes("kaboom"))).toBe(true);
      expect(rejections).toEqual([]);
    } finally {
      process.off("unhandledRejection", onRej);
    }
  });
});

describe("PipeSource: guard kształtu ramek (s7-bug-pipe-nonobject-frame)", () => {
  let srv: Server | null = null;
  afterEach(() => {
    srv?.close();
  });

  const frame = (o: unknown) => {
    const body = Buffer.from(typeof o === "string" ? o : JSON.stringify(o));
    const h = Buffer.alloc(4);
    h.writeUInt32LE(body.length);
    return Buffer.concat([h, body]);
  };
  const pipePath = () =>
    process.platform === "win32"
      ? `\\\\.\\pipe\\yoga-auto-test-${process.pid}-${Date.now()}`
      : join(tmpdir(), `yoga-auto-test-${process.pid}-${Date.now()}.sock`);

  async function run(frames: unknown[], handler?: (m: SourceMsg) => void) {
    const path = pipePath();
    let sock: Socket | undefined;
    srv = createServer((s) => {
      sock = s;
      s.on("error", () => {});
      for (const f of frames) s.write(frame(f));
    });
    await new Promise<void>((r) => srv!.listen(path, r));
    const src = new PipeSource(path);
    const got: SourceMsg[] = [];
    src.onMessage((m) => {
      got.push(m);
      handler?.(m);
    });
    await src.start();
    await sleep(250);
    await src.stop();
    sock?.destroy();
    return got;
  }

  it("nie-obiekty i ramki niezgodne ze schematem nie docierają do handlerów jako dane", async () => {
    const got = await run([
      "null",
      "[1,2,3]",
      "42",
      { foo: 1 },
      { t: "tel", ch: null },
      { t: "cfg", id: "job", attrs: "oops" },
      tel({ "truck.speed": 5 }),
    ]);
    expect(got.filter((m) => m.t === "tel")).toHaveLength(1);
    expect(got.filter((m) => m.t === "cfg")).toHaveLength(0);
    expect(got.filter((m) => m.t === "log" && m.msg.startsWith("bad frame"))).toHaveLength(6);
  });

  it("wyjątek handlera nie jest „bad frame” i nie przerywa parsera", async () => {
    const got = await run([tel({ "truck.speed": 1 }, 1), tel({ "truck.speed": 2 }, 2)], (m) => {
      if (m.t === "tel") throw new Error("handler boom");
    });
    expect(got.filter((m) => m.t === "tel")).toHaveLength(2);
    const logs = got.filter((m): m is Extract<SourceMsg, { t: "log" }> => m.t === "log").map((m) => m.msg);
    expect(logs.filter((m) => m.startsWith("handler threw"))).toHaveLength(2);
    expect(logs.some((m) => m.startsWith("bad frame"))).toBe(false);
  });
});

describe("hello.ipc (s7-bug-ipc-version-check)", () => {
  it("niezgodna wersja IPC: connected:false, tel/cfg/evt ignorowane; zgodny hello przywraca", async () => {
    const src = new ManualSource();
    const errors: string[] = [];
    const b = await boot(src, {
      log: (l, m) => {
        if (l === "error") errors.push(m);
      },
    });
    src.emit({ t: "connected" });
    src.emit(hello(IPC_VERSION + 1));
    expect(b.store.state.status.connected).toBe(false);
    expect(errors.some((e) => e.includes(`IPC v${IPC_VERSION + 1}`))).toBe(true);

    src.emit(tel({ "truck.speed": 20 }));
    src.emit({ t: "cfg", id: "truck", attrs: { brand: "Scania" } as never });
    src.emit({ t: "evt", id: "job.delivered", attrs: {} });
    await sleep(50);
    expect(b.store.state.status.connected).toBe(false);
    expect(b.store.state.fast.speed).toBe(0);

    src.emit(hello(IPC_VERSION));
    expect(b.store.state.status.connected).toBe(true);
    src.emit(tel({ "truck.speed": 20 }, 2));
    await sleep(50);
    expect(b.store.state.fast.speed).toBeGreaterThan(0);
  });
});

describe("hook rekordera (s7-recorder-hook)", () => {
  function fakeRecorder() {
    const r = {
      ipc: [] as SourceMsg[],
      ws: [] as { msg: ServerMsg; id?: string }[],
      flushed: 0,
      closed: 0,
      throws: false,
    };
    const rec: Recorder = {
      file: "x.yarec",
      ipc: (m) => {
        if (r.throws) throw new Error("disk full");
        r.ipc.push(m);
      },
      ws: (msg, id) => {
        if (r.throws) throw new Error("disk full");
        r.ws.push({ msg, ...(id ? { id } : {}) });
      },
      flush: () => void r.flushed++,
      close: async () => void r.closed++,
    };
    return { r, rec };
  }

  it("bez rekordera capabilities.record = false", async () => {
    const b = await boot(new ManualSource());
    const c = new TestClient(b.port);
    open.push(c);
    await c.opened();
    const h = await c.next("hello");
    expect(h.capabilities.record).toBe(false);
  });

  it("z rekorderem: capabilities.record, ipc + ws (broadcast raz, send z clientId), flush i close", async () => {
    const src = new ManualSource();
    const { r, rec } = fakeRecorder();
    const b = await boot(src, { recorder: rec });
    const c = new TestClient(b.port);
    open.push(c);
    await c.opened();
    expect((await c.next("hello")).capabilities.record).toBe(true);
    await c.next("snapshot");
    src.emit(hello(IPC_VERSION));
    src.emit(tel({ "truck.speed": 15 }));
    src.emit({ ...tel({}, 2), paused: true });
    c.send({ t: "ping", t0: 3 });
    await c.next("pong");
    await sleep(100);
    expect(r.ipc.map((m) => m.t)).toEqual(["hello", "tel", "tel"]);
    expect(r.ws.filter((w) => w.msg.t === "event" && !w.id)).toHaveLength(1); // broadcast raz, bez clientId
    expect(r.ws.some((w) => w.msg.t === "hello" && w.id)).toBe(true);
    expect(r.ws.some((w) => w.msg.t === "pong" && w.id)).toBe(true);
    expect(r.ws.some((w) => w.msg.t === "status" && w.id)).toBe(true);
    await b.close();
    open.splice(open.indexOf(b), 1); // już zamknięty
    expect(r.flushed).toBeGreaterThanOrEqual(1);
    expect(r.closed).toBe(1);
  });

  it("błąd rekordera nie zatrzymuje bridge'a", async () => {
    const src = new ManualSource();
    const { r, rec } = fakeRecorder();
    r.throws = true;
    const b = await boot(src, { recorder: rec });
    const c = await connect(b.port);
    src.emit(hello(IPC_VERSION));
    expect(b.store.state.status.connected).toBe(true);
    c.send({ t: "ping", t0: 1 });
    await c.next("pong");
  });
});

describe("latencja tel → ws.send (DoD: p95 < 2 ms)", () => {
  it("300 ramek tel przez PipeSource (named pipe) do 2 klientów WS: p95 < 2 ms", async () => {
    const path =
      process.platform === "win32"
        ? `\\\\.\\pipe\\yoga-auto-lat-${process.pid}-${Date.now()}`
        : join(tmpdir(), `yoga-auto-lat-${process.pid}-${Date.now()}.sock`);
    const enc = (o: unknown) => {
      const body = Buffer.from(JSON.stringify(o));
      const h = Buffer.alloc(4);
      h.writeUInt32LE(body.length);
      return Buffer.concat([h, body]);
    };
    let sock: Socket | undefined;
    const srv = createServer((s) => {
      sock = s;
      s.on("error", () => {});
      s.write(enc(hello(IPC_VERSION)));
    });
    await new Promise<void>((r) => srv.listen(path, r));
    const b = await boot(new PipeSource(path));
    const c1 = await connect(b.port);
    const c2 = await connect(b.port);
    c1.send({ t: "subscribe", fastHz: 60 });
    c2.send({ t: "subscribe", fastHz: 60 });
    await sleep(200);
    for (let i = 1; i <= 300; i++) {
      sock!.write(enc(tel({ "truck.speed": 10 + (i % 40) }, i)));
      await sleep(16);
    }
    const s = b.latency.summary();
    sock?.destroy();
    srv.close();
    expect(s.n).toBeGreaterThan(100);
    expect(s.p95).toBeLessThan(2);
  }, 20_000);
});
