/**
 * FakePipeServer — udawany plugin gry: serwer named pipe mówiący IPC v1 (docs/PROTOCOL.md §5).
 *
 * Dane bierze z wewnętrznego TelemetrySource („gra”): domyślnie MockSource ze scenariusza, może być
 * ReplaySource z nagrania `.yarec`. Gra działa niezależnie od klienta — jak prawdziwy plugin:
 * brak klienta = nic nie buforujemy, a nowy klient dostaje `hello`, wszystkie `cfg` i pełny `tel`.
 *
 * Zachowanie pluginu: 1 klient naraz (kolejny jest odrzucany), `in` → efekt w symulacji + `in.ack`,
 * watchdog: brak `hb` przez HOLD_WATCHDOG_MS → zwolnienie wszystkich trzymanych wejść.
 * Tryby awarii: patrz FaultSpec (faults.ts) i metody drop()/sendGarbage()/sendOversize()/stall().
 */
import { EventEmitter } from "node:events";
import { existsSync, unlinkSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { HOLD_WATCHDOG_MS, PIPE_NAME, ipc, type SourceMsg, type TelemetrySource } from "@yoga-auto/protocol";
import { createMockSource, type MockScenario } from "@yoga-auto/mock";
import { FrameDecoder, encodeFrame, encodeRaw } from "./framing.ts";
import { GARBAGE_KINDS, garbagePayload, type FaultSpec, type GarbageKind } from "./faults.ts";

export interface FakePipeOptions {
  /** ścieżka pipe; domyślnie `\\.\pipe\yoga-auto` (do testów: testPipePath()) */
  path?: string;
  /** „gra”: źródło danych (domyślnie MockSource ze `scenario`) */
  source?: TelemetrySource;
  scenario?: MockScenario;
  seed?: number;
  fps?: number;
  faults?: FaultSpec;
  /** true (domyślnie) = jak plugin: drugi klient odrzucany */
  exclusive?: boolean;
  log?: (msg: string) => void;
}

export interface FakePipeStats {
  connections: number;
  rejected: number;
  framesSent: number;
  telSent: number;
  garbageSent: number;
  hbReceived: number;
  lastHbAt: number | null;
  inReceived: number;
  badFramesReceived: number;
  watchdogReleases: number;
  held: string[];
}

export interface FakePipeEvents {
  listening: [path: string];
  client: [];
  disconnect: [reason: string];
  rejected: [];
  /** wiadomość od bridge'a (in/hb/releaseAll/opts) */
  recv: [msg: ipc.IpcToPlugin];
  /** niepoprawna ramka od bridge'a */
  bad: [error: string];
  /** watchdog zwolnił wejścia */
  watchdog: [inputs: string[]];
  sent: [msg: unknown];
}

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000;
}

export class FakePipeServer extends EventEmitter<FakePipeEvents> {
  readonly path: string;
  readonly source: TelemetrySource;
  faults: FaultSpec;
  private server: Server | null = null;
  private sock: Socket | null = null;
  private decoder = new FrameDecoder();
  private connTimers: ReturnType<typeof setTimeout>[] = [];
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  private unsub: (() => void) | null = null;
  private rand: () => number;
  private log: (msg: string) => void;
  private exclusive: boolean;
  private writeChain: Promise<void> = Promise.resolve();
  private stalledUntil = 0;
  private telSinceConnect = 0;
  // cache „gry” do odtworzenia stanu dla nowego klienta
  private hello: ipc.IpcHello | null = null;
  private cfgs = new Map<string, ipc.IpcConfig>();
  private inputActive = new Map<string, ipc.IpcInputActive>();
  private fullCh: Record<string, ipc.IpcValue> = {};
  private lastTel: Omit<ipc.IpcTelemetry, "ch"> | null = null;
  private held = new Set<string>();
  readonly stats: FakePipeStats = {
    connections: 0,
    rejected: 0,
    framesSent: 0,
    telSent: 0,
    garbageSent: 0,
    hbReceived: 0,
    lastHbAt: null,
    inReceived: 0,
    badFramesReceived: 0,
    watchdogReleases: 0,
    held: [],
  };

  constructor(opts: FakePipeOptions = {}) {
    super();
    this.path = opts.path ?? PIPE_NAME;
    this.faults = { ...opts.faults };
    this.exclusive = opts.exclusive ?? true;
    this.rand = rng(opts.seed ?? 7);
    this.log = opts.log ?? (() => {});
    this.source =
      opts.source ??
      createMockSource({
        scenario: opts.scenario ?? "highway",
        ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
        ...(opts.fps !== undefined ? { fps: opts.fps } : {}),
      });
  }

  get connected(): boolean {
    return !!this.sock && !this.sock.destroyed;
  }

  async start(): Promise<void> {
    if (this.server) return;
    this.unsub = this.source.onMessage((m) => this.onGame(m));
    await this.source.start();
    if (process.platform !== "win32" && existsSync(this.path)) unlinkSync(this.path);
    const server = createServer((s) => this.onConnection(s));
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.path, () => {
        server.off("error", reject);
        resolve();
      });
    });
    this.watchdogTimer = setInterval(() => this.watchdog(), 100);
    this.log(`fake-pipe listening on ${this.path}`);
    this.emit("listening", this.path);
  }

  async stop(): Promise<void> {
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);
    this.watchdogTimer = null;
    this.clearConnTimers();
    this.sock?.destroy();
    this.sock = null;
    this.unsub?.();
    this.unsub = null;
    await this.source.stop();
    const server = this.server;
    this.server = null;
    if (server) await new Promise<void>((r) => server.close(() => r()));
  }

  /** Zmień tryby awarii w locie (dotyczy też bieżącego połączenia, poza timerami połączenia). */
  setFaults(f: FaultSpec): void {
    this.faults = { ...f };
  }

  // ───────────────────────────── API awarii (do testów) ─────────────────────────────

  /** Zerwij bieżące połączenie (jak crash gry / zamknięcie pipe). */
  drop(reason = "drop"): void {
    if (!this.sock) return;
    this.log(`fake-pipe: dropping client (${reason})`);
    this.sock.destroy();
  }

  sendGarbage(kind?: GarbageKind): void {
    const kinds = this.faults.garbageKinds?.length ? this.faults.garbageKinds : GARBAGE_KINDS;
    const k = kind ?? kinds[Math.floor(this.rand() * kinds.length)]!;
    this.stats.garbageSent++;
    this.write(encodeRaw(garbagePayload(k, this.rand)));
  }

  /** Ramka z długością > limit. `withBody` = wyślij też cały payload (domyślnie tylko nagłówek + 1 KiB). */
  sendOversize(withBody = false): void {
    const len = ipc.IPC_MAX_FRAME_BYTES + 1;
    const body = withBody ? Buffer.alloc(len, 0x20) : Buffer.alloc(1024, 0x20);
    this.write(encodeRaw(body, len));
  }

  /** Surowe bajty do klienta. */
  sendRaw(bytes: Buffer): void {
    this.write(bytes);
  }

  /** Dowolna wiadomość (np. sfabrykowany `evt`). */
  sendMsg(msg: unknown): void {
    this.write(encodeFrame(msg));
    this.emit("sent", msg);
  }

  /** Wstrzymaj wysyłkę `tel` na `ms` (połączenie zostaje). */
  stall(ms: number): void {
    this.stalledUntil = Date.now() + ms;
  }

  /** Ustaw kanał w stanie „gry” i wyślij go (np. do testu konkretnej wartości). */
  injectChannels(ch: Record<string, ipc.IpcValue>): void {
    Object.assign(this.fullCh, ch);
    if (this.lastTel) this.sendTel({ ...this.lastTel, ch });
  }

  heldInputs(): string[] {
    return [...this.held];
  }

  // ───────────────────────────── internals ─────────────────────────────

  private onConnection(s: Socket) {
    if (this.exclusive && this.connected) {
      this.stats.rejected++;
      this.emit("rejected");
      s.destroy();
      return;
    }
    this.sock = s;
    this.decoder = new FrameDecoder();
    this.writeChain = Promise.resolve();
    this.telSinceConnect = 0;
    this.stats.connections++;
    this.stats.lastHbAt = Date.now(); // watchdog liczy od połączenia
    s.on("data", (chunk: Buffer) => this.onData(chunk));
    s.on("error", () => {});
    s.on("close", () => {
      if (this.sock !== s) return;
      this.sock = null;
      this.clearConnTimers();
      this.emit("disconnect", "closed");
    });
    this.armConnTimers();
    this.emit("client");
    this.greet();
  }

  private armConnTimers() {
    const f = this.faults;
    if (f.dropEveryMs && f.dropEveryMs > 0)
      this.connTimers.push(setTimeout(() => this.drop("dropEveryMs"), f.dropEveryMs));
    if (f.oversizeAfterMs !== undefined) this.connTimers.push(setTimeout(() => this.sendOversize(), f.oversizeAfterMs));
    if (f.stallAfterMs !== undefined)
      this.connTimers.push(setTimeout(() => this.stall(f.stallMs ?? 5000), f.stallAfterMs));
  }

  private clearConnTimers() {
    this.connTimers.forEach(clearTimeout);
    this.connTimers = [];
  }

  private greet() {
    const f = this.faults;
    if (this.hello && !f.noHello) {
      const hello = { ...this.hello };
      if (f.ipcVersion !== undefined) hello.ipc = f.ipcVersion;
      if (f.inputDisabled) hello.inputEnabled = false;
      this.sendMsg(hello);
    }
    for (const c of this.cfgs.values()) this.sendMsg(c);
    for (const a of this.inputActive.values()) this.sendMsg(f.inputDisabled ? { ...a, active: false } : a);
    if (this.lastTel) this.sendTel({ ...this.lastTel, ch: { ...this.fullCh } }, true);
  }

  private onGame(m: SourceMsg) {
    switch (m.t) {
      case "connected":
      case "disconnected":
        return; // „gra” jest zawsze; połączenie to sprawa pipe
      case "hello":
        this.hello = m;
        if (this.connected && !this.faults.noHello) this.greet();
        return;
      case "cfg":
        if (m.attrs === null) this.cfgs.delete(m.id);
        else this.cfgs.set(m.id, m);
        break;
      case "input.active":
        this.inputActive.set(m.device, m);
        if (this.faults.inputDisabled) return;
        break;
      case "tel": {
        Object.assign(this.fullCh, m.ch);
        const { ch, ...rest } = m;
        this.lastTel = rest;
        this.sendTel(m);
        return;
      }
      case "in.ack": {
        const f = this.faults;
        if (f.dropAcks) return;
        const ack = f.ackFail || f.inputDisabled ? { ...m, ok: false } : m;
        if (f.ackDelayMs) setTimeout(() => this.connected && this.sendMsg(ack), f.ackDelayMs);
        else if (this.connected) this.sendMsg(ack);
        return;
      }
    }
    if (this.connected) this.sendMsg(m);
  }

  private sendTel(m: ipc.IpcTelemetry, initial = false) {
    if (!this.connected) return;
    if (!initial && Date.now() < this.stalledUntil) return;
    const f = this.faults;
    if (!initial && f.garbageRate && this.rand() < f.garbageRate) this.sendGarbage();
    this.stats.telSent++;
    this.telSinceConnect++;
    this.sendMsg(m);
    if (f.dropAfterFrames && this.telSinceConnect >= f.dropAfterFrames) this.drop("dropAfterFrames");
  }

  private write(buf: Buffer) {
    const s = this.sock;
    if (!s || s.destroyed) return;
    this.stats.framesSent++;
    const frag = this.faults.fragment === true ? 7 : this.faults.fragment || 0;
    if (!frag) {
      s.write(buf);
      return;
    }
    // kawałki z przerwą (setImmediate), żeby system nie skleił ich z powrotem w jeden odczyt
    for (let i = 0; i < buf.length; i += frag) {
      const piece = buf.subarray(i, i + frag);
      this.writeChain = this.writeChain.then(
        () =>
          new Promise<void>((r) => {
            if (!s.destroyed) s.write(piece);
            setImmediate(r);
          }),
      );
    }
  }

  private onData(chunk: Buffer) {
    for (const r of this.decoder.push(chunk)) {
      if (!r.ok) {
        this.stats.badFramesReceived++;
        this.emit("bad", r.error);
        if (r.error === "too_large") this.drop("client frame too large");
        continue;
      }
      const msg = r.msg as ipc.IpcToPlugin;
      if (!msg || typeof msg !== "object" || typeof (msg as { t?: unknown }).t !== "string") {
        this.stats.badFramesReceived++;
        this.emit("bad", "not an IPC message");
        continue;
      }
      this.onClientMsg(msg);
    }
  }

  private onClientMsg(msg: ipc.IpcToPlugin) {
    this.emit("recv", msg);
    switch (msg.t) {
      case "hb":
        this.stats.hbReceived++;
        this.stats.lastHbAt = Date.now();
        break;
      case "in":
        this.stats.inReceived++;
        if (this.faults.inputDisabled) {
          this.sendMsg({ t: "in.ack", seq: msg.seq, frame: this.lastTel?.frame ?? 0, ok: false });
          return;
        }
        if (msg.op === "down") this.held.add(msg.input);
        else if (msg.op === "up") this.held.delete(msg.input);
        break;
      case "releaseAll":
        this.held.clear();
        break;
      case "opts":
        break;
    }
    this.stats.held = [...this.held];
    this.source.send(msg);
  }

  private watchdog() {
    if (!this.held.size) return;
    const last = this.stats.lastHbAt ?? 0;
    if (Date.now() - last <= HOLD_WATCHDOG_MS) return;
    const released = [...this.held];
    this.held.clear();
    this.stats.held = [];
    this.stats.watchdogReleases++;
    this.source.send({ t: "releaseAll" });
    this.log(`fake-pipe watchdog: no hb for >${HOLD_WATCHDOG_MS} ms, released ${released.join(", ")}`);
    if (this.connected)
      this.sendMsg({ t: "log", level: "warn", msg: `watchdog: no hb, released ${released.join(", ")}` });
    this.emit("watchdog", released);
  }
}
