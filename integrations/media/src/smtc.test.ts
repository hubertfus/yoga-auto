import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaState } from "@yoga-auto/protocol";
import { AutoMediaProvider } from "./factory.ts";
import { parseLine, toMediaState, trackKey, type HelperRawState } from "./helper-protocol.ts";
import { MockMediaProvider } from "./mock.ts";
import { SmtcMediaProvider, type HelperProcess } from "./smtc.ts";

const raw = (o: Partial<HelperRawState> = {}): HelperRawState => ({
  source: "Spotify.exe",
  status: "playing",
  title: "Song",
  artist: "Artist",
  album: "Album",
  position: 10,
  duration: 200,
  canPlay: true,
  canPause: true,
  canNext: true,
  canPrev: true,
  canSeek: true,
  ...o,
});
const line = (o: unknown) => JSON.stringify(o) + "\n";

class FakeProc extends EventEmitter {
  stdout = new PassThrough();
  written: string[] = [];
  ended = false;
  killed = false;
  stdin = {
    write: (s: string) => (this.written.push(s), true),
    end: () => void (this.ended = true),
  };
  kill() {
    this.killed = true;
    this.emit("exit", null);
  }
  send(o: unknown) {
    this.stdout.write(line(o));
  }
  asHelper() {
    return this as unknown as HelperProcess;
  }
}

describe("parseLine", () => {
  it("ignoruje śmieci i nieznane typy", () => {
    expect(parseLine("")).toBeNull();
    expect(parseLine("Windows PowerShell banner")).toBeNull();
    expect(parseLine("{zepsute")).toBeNull();
    expect(parseLine('{"t":"nieznany"}')).toBeNull();
    expect(parseLine('{"t":"art","key":"k"}')).toBeNull();
  });
  it("parsuje ready/ack/error/state(null)", () => {
    expect(parseLine('{"t":"ready"}')).toEqual({ t: "ready" });
    expect(parseLine('{"t":"ack","id":3,"ok":false,"err":"x"}')).toEqual({ t: "ack", id: 3, ok: false, err: "x" });
    expect(parseLine('{"t":"error","msg":"m"}')).toEqual({ t: "error", msg: "m" });
    expect(parseLine('{"t":"state","s":null}')).toEqual({ t: "state", s: null });
  });
  it("normalizuje stan: puste stringi → null, brak flag → false", () => {
    const m = parseLine(
      '{"t":"state","s":{"source":"Chrome","status":"playing","title":"T","artist":"","album":"","position":1.5,"duration":null,"canPlay":true}}',
    );
    expect(m).toEqual({
      t: "state",
      s: {
        source: "Chrome",
        status: "playing",
        title: "T",
        artist: null,
        album: null,
        position: 1.5,
        duration: null,
        canPlay: true,
        canPause: false,
        canNext: false,
        canPrev: false,
        canSeek: false,
      },
    });
  });
});

describe("toMediaState", () => {
  it("mapuje pola, artUrl i positionAt", () => {
    const s = toMediaState(raw(), "abc123", 1000);
    expect(s).toMatchObject({
      source: "Spotify.exe",
      status: "playing",
      artUrl: "/media/art/abc123.jpg",
      position: 10,
      positionAt: 1000,
    });
  });
  it("nieznany status → unknown, brak pozycji → positionAt null, brak okładki → artUrl null", () => {
    const s = toMediaState(raw({ status: "changing", position: null, duration: null }), null, 5);
    expect(s).toMatchObject({ status: "unknown", artUrl: null, position: null, positionAt: null });
  });
});

describe("SmtcMediaProvider", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const setup = (opts: ConstructorParameters<typeof SmtcMediaProvider>[0] = {}) => {
    const procs: FakeProc[] = [];
    const prefer: boolean[] = [];
    const p = new SmtcMediaProvider({
      spawn: (pref) => {
        prefer.push(pref);
        const f = new FakeProc();
        procs.push(f);
        return f.asHelper();
      },
      backoffMs: () => 100,
      now: () => 777,
      ...opts,
    });
    return { p, procs, prefer };
  };
  const started = async (opts?: Parameters<typeof setup>[0]) => {
    const h = setup(opts);
    const st = h.p.start();
    h.procs[0]!.send({ t: "ready" });
    await st;
    return h;
  };

  it("start czeka na ready; przekazuje preferSpotify", async () => {
    const { p, procs, prefer } = setup({ preferSpotify: true });
    let done = false;
    const st = p.start().then(() => (done = true));
    await vi.advanceTimersByTimeAsync(10);
    expect(done).toBe(false);
    procs[0]!.send({ t: "ready" });
    await st;
    expect(done).toBe(true);
    expect(prefer).toEqual([true]);
    await p.stop();
  });

  it("stan z helpera → MediaState + emisja do onChange", async () => {
    const { p, procs } = await started();
    const seen: (MediaState | null)[] = [];
    p.onChange((s) => seen.push(s));
    procs[0]!.send({ t: "state", s: raw() });
    await vi.advanceTimersByTimeAsync(0);
    expect(p.getState()).toMatchObject({
      title: "Song",
      artist: "Artist",
      status: "playing",
      positionAt: 777,
      artUrl: null,
    });
    expect(seen).toHaveLength(1);
    await p.stop();
  });

  it("okładka dołączona po state: artUrl + getArt (hash jak w bridge)", async () => {
    const { p, procs } = await started();
    const s = raw();
    procs[0]!.send({ t: "state", s });
    const bytes = Buffer.from([1, 2, 3, 4]);
    procs[0]!.send({ t: "art", key: trackKey(s), mime: "image/png", b64: bytes.toString("base64") });
    await vi.advanceTimersByTimeAsync(0);
    const url = p.getState()!.artUrl!;
    expect(url).toMatch(/^\/media\/art\/[0-9a-f]{16}\.jpg$/);
    const art = await p.getArt(url.replace("/media/art/", "").replace(".jpg", ""));
    expect(art).toEqual({ mime: "image/png", data: new Uint8Array([1, 2, 3, 4]) });
    expect(await p.getArt("nieistnieje")).toBeNull();
    await p.stop();
  });

  it("okładka dla innego utworu nie nadpisuje bieżącego stanu", async () => {
    const { p, procs } = await started();
    procs[0]!.send({ t: "state", s: raw() });
    procs[0]!.send({ t: "art", key: trackKey(raw({ title: "Inny" })), mime: "image/jpeg", b64: "AQID" });
    await vi.advanceTimersByTimeAsync(0);
    expect(p.getState()!.artUrl).toBeNull();
    await p.stop();
  });

  it("state null (brak sesji) → getState null", async () => {
    const { p, procs } = await started();
    procs[0]!.send({ t: "state", s: raw() });
    procs[0]!.send({ t: "state", s: null });
    await vi.advanceTimersByTimeAsync(0);
    expect(p.getState()).toBeNull();
    await p.stop();
  });

  it("komenda: JSON do stdin, rozwiązanie po ack ok", async () => {
    const { p, procs } = await started();
    const c = p.command("seek", 42);
    expect(JSON.parse(procs[0]!.written[0]!)).toEqual({ id: 1, cmd: "seek", value: 42 });
    procs[0]!.send({ t: "ack", id: 1, ok: true });
    await expect(c).resolves.toBeUndefined();
    await p.stop();
  });

  it("komenda: ack ok=false odrzuca; timeout odrzuca", async () => {
    const { p, procs } = await started({ commandTimeoutMs: 500 });
    const e1 = expect(p.command("next")).rejects.toThrow("nope");
    procs[0]!.send({ t: "ack", id: 1, ok: false, err: "nope" });
    await e1;
    const e2 = expect(p.command("prev")).rejects.toThrow("timeout");
    await vi.advanceTimersByTimeAsync(600);
    await e2;
    await p.stop();
  });

  it("restart: po śmierci helpera stan → null, nowy proces po backoffie, komendy znów działają", async () => {
    const { p, procs } = await started();
    procs[0]!.send({ t: "state", s: raw() });
    await vi.advanceTimersByTimeAsync(0);
    expect(p.getState()).not.toBeNull();
    const rej = expect(p.command("play")).rejects.toThrow();
    procs[0]!.emit("exit", 1);
    await rej;
    expect(p.getState()).toBeNull();
    await vi.advanceTimersByTimeAsync(100);
    expect(procs).toHaveLength(2);
    procs[1]!.send({ t: "ready" });
    procs[1]!.send({ t: "state", s: raw({ title: "Po restarcie" }) });
    await vi.advanceTimersByTimeAsync(0);
    expect(p.getState()!.title).toBe("Po restarcie");
    await p.stop();
  });

  it("poddaje się po maxFailures: stan null, komendy odrzucane, bez dalszych spawnów", async () => {
    const { p, procs } = await started({ maxFailures: 2 });
    procs[0]!.emit("exit", 1);
    await vi.advanceTimersByTimeAsync(100);
    procs[1]!.emit("exit", 1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(procs).toHaveLength(2);
    expect(p.getState()).toBeNull();
    await expect(p.command("play")).rejects.toThrow("unavailable");
    await p.stop();
  });

  it("start odrzucony, gdy helper pada przed ready", async () => {
    const { p, procs } = setup();
    const e = expect(p.start()).rejects.toThrow();
    procs[0]!.emit("exit", 2);
    await e;
    await p.stop();
  });

  it("start odrzucony po readyTimeout (helper zawieszony → kill)", async () => {
    const { p, procs } = setup({ readyTimeoutMs: 1000 });
    const e = expect(p.start()).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(1100);
    await e;
    expect(procs[0]!.killed).toBe(true);
    await p.stop();
  });

  it("stop zamyka stdin helpera i go ubija", async () => {
    const { p, procs } = await started();
    await p.stop();
    expect(procs[0]!.ended).toBe(true);
    expect(procs[0]!.killed).toBe(true);
  });

  it("kawałkowane linie i śmieci na stdout nie psują parsowania", async () => {
    const { p, procs } = await started();
    const l = line({ t: "state", s: raw() });
    procs[0]!.stdout.write("śmieci bez JSON\n");
    procs[0]!.stdout.write(l.slice(0, 20));
    procs[0]!.stdout.write(l.slice(20));
    await vi.advanceTimersByTimeAsync(0);
    expect(p.getState()!.title).toBe("Song");
    await p.stop();
  });
});

describe("AutoMediaProvider", () => {
  it("fallback na Null, gdy helper nie wstał — start nie rzuca", async () => {
    const logs: string[] = [];
    const a = new AutoMediaProvider({
      force: "smtc",
      spawn: () => {
        throw new Error("brak powershella");
      },
      log: (_l, m) => logs.push(m),
    });
    await expect(a.start()).resolves.toBeUndefined();
    expect(a.name).toBe("null");
    expect(a.getState()).toBeNull();
    await expect(a.command("play")).rejects.toThrow();
    expect(logs[0]).toMatch(/fallback/);
    await a.stop();
  });

  it("poza Windows → Null; force mock → Mock", () => {
    expect(new AutoMediaProvider({ platform: "linux" }).name).toBe("null");
    expect(new AutoMediaProvider({ force: "mock" }).name).toBe("mock");
  });

  it("przekazuje zdarzenia i stan providera SMTC", async () => {
    const f = new FakeProc();
    const a = new AutoMediaProvider({ force: "smtc", spawn: () => f.asHelper() });
    const seen: unknown[] = [];
    a.onChange((s) => seen.push(s));
    const st = a.start();
    f.send({ t: "ready" });
    await st;
    f.send({ t: "state", s: raw() });
    await new Promise((r) => setTimeout(r, 20));
    expect(a.name).toBe("smtc");
    expect(seen).toHaveLength(1);
    expect(a.getState()!.title).toBe("Song");
    await a.stop();
  });
});

describe("MockMediaProvider", () => {
  it("serwuje okładkę SVG pod artUrl", async () => {
    const m = new MockMediaProvider();
    const url = m.getState().artUrl!;
    const art = await m.getArt(url.replace("/media/art/", "").replace(".jpg", ""));
    expect(art?.mime).toBe("image/svg+xml");
    expect(new TextDecoder().decode(art!.data)).toContain("<svg");
    expect(await m.getArt("x")).toBeNull();
  });
  it("next/prev zmieniają utwór, seek ustawia pozycję", async () => {
    const m = new MockMediaProvider();
    const t0 = m.getState().title;
    await m.command("next");
    expect(m.getState().title).not.toBe(t0);
    await m.command("prev");
    expect(m.getState().title).toBe(t0);
    await m.command("seek", 50);
    expect(m.getState().position).toBeGreaterThanOrEqual(50);
  });
});
