import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { Ajv } from "ajv";
import { afterAll, describe, expect, it } from "vitest";
import type { SourceMsg } from "@yoga-auto/protocol";
import { createRequire } from "node:module";
import { YarecRecorder } from "./recorder.ts";
import { ReplaySource } from "./replay.ts";
import { SAMPLES, synthesize } from "./synth.ts";
import { cutYarec, infoYarec, parseYarec, readYarec, serializeYarec, speedYarec, stateAt } from "./yarec.ts";

const require = createRequire(import.meta.url);
const ajv = new Ajv({ allErrors: true, strict: false });
const fromPlugin = ajv.compile(
  JSON.parse(readFileSync(require.resolve("@yoga-auto/protocol/schema/ipc-from-plugin.schema.json"), "utf8")),
);
const samplesDir = resolve(import.meta.dirname, "../samples");
const tmp = mkdtempSync(join(tmpdir(), "yarec-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("samples", () => {
  for (const s of SAMPLES) {
    it(`${s.file} exists, parses, matches schema`, () => {
      const y = readYarec(resolve(samplesDir, s.file));
      expect(y.truncated).toBe(false);
      expect(y.meta?.source).toBe("synthetic");
      expect(y.durationMs).toBeGreaterThan(s.opts.seconds * 1000 - 100);
      for (const e of y.entries) {
        if (e.kind !== "ipc") continue;
        const m = e.msg as SourceMsg;
        if (m.t === "connected" || m.t === "disconnected") continue;
        expect(fromPlugin(m), JSON.stringify([m.t, fromPlugin.errors]).slice(0, 300)).toBe(true);
      }
      const info = infoYarec(y);
      expect(info.ipc.hello).toBe(1);
      expect(info.telFrames).toBeGreaterThan(s.opts.seconds * 25);
    });
  }
  it("job-cycle sample contains job.delivered", () => {
    const info = infoYarec(readYarec(resolve(samplesDir, "job-cycle-90s.yarec")));
    expect(info.events.map((e) => e.id)).toContain("job.delivered");
  });
  it("sample files are reproducible (deterministic synth)", async () => {
    for (const s of SAMPLES) {
      const fresh = serializeYarec(await synthesize(s.opts));
      expect(gunzipSync(fresh).equals(gunzipSync(readFileSync(resolve(samplesDir, s.file))))).toBe(true);
    }
  });
});

describe("yarec operations", () => {
  const y = readYarec(resolve(samplesDir, "job-cycle-90s.yarec"));

  it("cut keeps a consistent starting state", () => {
    const c = cutYarec(y, 62_000, 80_000);
    expect(c.entries[0]!.ts).toBe(0);
    const info = infoYarec(c);
    expect(info.ipc.hello).toBe(1);
    expect(c.durationMs).toBeLessThanOrEqual(18_000);
    const first = c.entries.find((e) => (e.msg as { t: string }).t === "tel")!.msg as { ch: object };
    expect(Object.keys(first.ch).length).toBeGreaterThan(60); // pełny stan, nie delta
    // po 62 s zlecenie jest dostarczone → cfg job nie powinien być w stanie początkowym
    expect(
      c.entries.some(
        (e) =>
          (e.msg as { t: string; id?: string }).t === "cfg" && (e.msg as { id: string }).id === "job" && e.ts === 0,
      ),
    ).toBe(false);
  });

  it("speed rescales time", () => {
    const s = speedYarec(y, 2);
    expect(s.durationMs).toBeCloseTo(y.durationMs / 2, -1);
  });

  it("stateAt accumulates deltas", () => {
    const snap = stateAt(y.entries, 30_000);
    const tel = snap.tel as unknown as { ch: Record<string, unknown> };
    expect(Object.keys(tel.ch).length).toBeGreaterThan(60);
    expect(snap.cfgs.some((c) => (c as { id: string }).id === "truck")).toBe(true);
  });

  it("round-trips through serialize/parse", () => {
    const back = parseYarec(serializeYarec(y));
    expect(back.entries.length).toBe(y.entries.length);
    expect(back.meta).toEqual(y.meta);
  });

  it("tolerates a truncated file", () => {
    const buf = serializeYarec(y);
    const back = parseYarec(buf.subarray(0, Math.floor(buf.length * 0.6)));
    expect(back.truncated).toBe(true);
    expect(back.entries.length).toBeGreaterThan(100);
  });
});

describe("YarecRecorder", () => {
  it("records ipc + ws with monotonic ts and survives flush-without-close", async () => {
    const file = join(tmp, "rec.yarec");
    let now = 1000;
    const rec = new YarecRecorder(file, { meta: { source: "test" }, now: () => now });
    rec.ipc({ t: "connected" });
    now += 10;
    rec.ipc({ t: "log", level: "info", msg: "hi" });
    now += 5;
    rec.ws({ t: "pong", t0: 1, ts: 2 });
    rec.flush();
    await sleep(100);
    // czytelny, zanim zamkniemy (jak po crashu procesu)
    const mid = parseYarec(readFileSync(file));
    expect(mid.entries.map((e) => e.kind)).toEqual(["ipc", "ipc", "ws"]);
    await rec.close();
    const y = readYarec(file);
    expect(y.truncated).toBe(false);
    expect(y.entries.map((e) => e.ts)).toEqual([0, 10, 15]);
    expect(y.meta?.source).toBe("test");
  });

  it("ws:false and wsSkipFast filter output", async () => {
    const file = join(tmp, "rec2.yarec");
    const rec = new YarecRecorder(file, { wsSkipFast: true });
    rec.ws({ t: "fast", seq: 1, ts: 1, frame: 1, d: {} });
    rec.ws({ t: "pong", t0: 1, ts: 2 });
    await rec.close();
    expect(readYarec(file).entries.length).toBe(1);
  });
});

describe("ReplaySource", () => {
  const file = resolve(samplesDir, "highway-60s.yarec");

  it("emits connected → hello → cfg → full tel first", async () => {
    const src = new ReplaySource({ file, speed: 32 });
    const msgs: SourceMsg[] = [];
    src.onMessage((m) => msgs.push(m));
    await src.start();
    await sleep(50);
    await src.stop();
    expect(msgs.slice(0, 2).map((m) => m.t)).toEqual(["connected", "hello"]);
    expect(msgs.findIndex((m) => m.t === "tel")).toBeGreaterThan(2);
    expect(msgs.at(-1)).toMatchObject({ t: "disconnected" });
  });

  it("plays at the requested speed and ends", async () => {
    const short = cutYarec(readYarec(file), 0, 6000);
    let ended = false;
    const src = new ReplaySource({ recording: short, speed: 8, onEnd: () => (ended = true) });
    const msgs: SourceMsg[] = [];
    src.onMessage((m) => msgs.push(m));
    const t0 = performance.now();
    await src.start();
    while (!ended && performance.now() - t0 < 3000) await sleep(10);
    const took = performance.now() - t0;
    expect(ended).toBe(true);
    expect(took).toBeGreaterThan(6000 / 8 - 150);
    expect(took).toBeLessThan(6000 / 8 + 400);
    expect(msgs.filter((m) => m.t === "tel").length).toBeGreaterThan(150);
    expect(msgs.at(-1)).toMatchObject({ t: "disconnected", reason: "replay ended" });
    await src.stop();
  });

  it("loops, re-emitting state", async () => {
    const short = cutYarec(readYarec(file), 0, 1000);
    const src = new ReplaySource({ recording: short, speed: 32, loop: true });
    const hellos: number[] = [];
    src.onMessage((m) => m.t === "hello" && hellos.push(1));
    await src.start();
    await sleep(300);
    await src.stop();
    expect(hellos.length).toBeGreaterThanOrEqual(3);
  });

  it("pause stops emission, resume continues", async () => {
    const src = new ReplaySource({ file, speed: 8 });
    let tel = 0;
    src.onMessage((m) => m.t === "tel" && tel++);
    await src.start();
    await sleep(100);
    src.pause();
    await sleep(30);
    const n = tel;
    await sleep(150);
    expect(tel).toBe(n);
    src.resume();
    await sleep(150);
    expect(tel).toBeGreaterThan(n);
    await src.stop();
  });

  it("seek emits a consistent state at that point", async () => {
    const src = new ReplaySource({ file, speed: 0.1, paused: true });
    const msgs: SourceMsg[] = [];
    src.onMessage((m) => msgs.push(m));
    await src.start();
    msgs.length = 0;
    src.seek(30_000);
    expect(msgs[0]!.t).toBe("hello");
    const tel = msgs.find((m) => m.t === "tel") as { ch: Record<string, unknown> };
    expect(Object.keys(tel.ch).length).toBeGreaterThan(60);
    expect(src.position).toBe(30_000);
    await src.stop();
  });

  it("answers `in` with ack ok:false and drops recorded acks", async () => {
    const src = new ReplaySource({ file, speed: 1 });
    const acks: SourceMsg[] = [];
    src.onMessage((m) => m.t === "in.ack" && acks.push(m));
    await src.start();
    src.send({ t: "in", seq: 4, device: "semantical", input: "light", op: "press" });
    await src.stop();
    expect(acks).toEqual([{ t: "in.ack", seq: 4, frame: 0, ok: false }]);
  });

  it("speed is clamped", () => {
    const src = new ReplaySource({ file, speed: 1000 });
    expect(src.speed).toBe(32);
    src.setSpeed(0);
    expect(src.speed).toBe(0.1);
  });

  it("reads a file written by YarecRecorder", async () => {
    const f = join(tmp, "x.yarec");
    writeFileSync(
      f,
      serializeYarec({ meta: null, entries: [{ ts: 0, kind: "ipc", msg: { t: "log", level: "info", msg: "x" } }] }),
    );
    const src = new ReplaySource({ file: f, speed: 32 });
    const msgs: SourceMsg[] = [];
    src.onMessage((m) => msgs.push(m));
    await src.start();
    await sleep(60);
    await src.stop();
    expect(msgs.some((m) => m.t === "log")).toBe(true);
  });
});
