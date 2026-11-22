/**
 * ReplaySource — odtwarza nagranie `.yarec` jako `TelemetrySource` (kind "replay").
 *
 * Emituje wpisy `ipc` według osi czasu nagrania (× prędkość). `connected`/`disconnected` generuje sam
 * (nagrane ignoruje, chyba że `faithfulConnection`). Odtwarzanie nie reaguje na wejścia: `in` dostaje
 * `in.ack{ok:false}` (bridge odpowie UI `not_supported`), a nagrane `in.ack` są pomijane.
 * Po `seek()` oraz na początku pętli emituje spójny stan z tego momentu (hello, cfg, pełny tel).
 */
import type { SourceMsg, TelemetrySource, ipc } from "@yoga-auto/protocol";
import { isIpcEntry, readYarec, stateAt, type Yarec, type YarecEntry } from "./yarec.ts";

export const REPLAY_MIN_SPEED = 0.1;
export const REPLAY_MAX_SPEED = 32;

export interface ReplayOptions {
  /** ścieżka `.yarec` albo gotowe nagranie */
  file?: string;
  recording?: Yarec;
  /** x0.5–x8 w zastosowaniu zwykłym; dozwolone 0.1–32 */
  speed?: number;
  loop?: boolean;
  /** start od ms nagrania (stan z tego momentu jest emitowany na starcie) */
  startAtMs?: number;
  /** odtwarzaj też nagrane `connected`/`disconnected` (testy rozłączeń z prawdziwej sesji) */
  faithfulConnection?: boolean;
  /** start w pauzie */
  paused?: boolean;
  onEnd?: () => void;
}

const TICK_MS = 4;

export class ReplaySource implements TelemetrySource {
  readonly kind = "replay" as const;
  readonly recording: Yarec;
  private readonly entries: YarecEntry[];
  private handlers = new Set<(m: SourceMsg) => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastWall = 0;
  private playhead = 0;
  private idx = 0;
  private _speed: number;
  private _paused: boolean;
  private _ended = false;
  private running = false;
  private readonly loop: boolean;
  private readonly startAt: number;
  private readonly faithful: boolean;
  private readonly onEnd: (() => void) | undefined;
  loops = 0;

  constructor(opts: ReplayOptions) {
    if (opts.recording) this.recording = opts.recording;
    else if (opts.file) this.recording = readYarec(opts.file);
    else throw new Error("ReplaySource: file or recording required");
    this.entries = this.recording.entries.filter((e) => {
      if (!isIpcEntry(e)) return false;
      const t = e.msg.t;
      if (t === "in.ack") return false;
      if (!opts.faithfulConnection && (t === "connected" || t === "disconnected")) return false;
      return true;
    });
    this._speed = clampSpeed(opts.speed ?? 1);
    this._paused = opts.paused ?? false;
    this.loop = opts.loop ?? false;
    this.startAt = opts.startAtMs ?? 0;
    this.faithful = opts.faithfulConnection ?? false;
    this.onEnd = opts.onEnd;
  }

  get speed(): number {
    return this._speed;
  }
  get paused(): boolean {
    return this._paused;
  }
  get ended(): boolean {
    return this._ended;
  }
  /** pozycja w nagraniu, ms */
  get position(): number {
    return this.playhead;
  }
  get duration(): number {
    return this.recording.durationMs;
  }

  onMessage(handler: (m: SourceMsg) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this._ended = false;
    this.emit({ t: "connected" });
    this.seekInternal(this.startAt);
    this.lastWall = performance.now();
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.emit({ t: "disconnected", reason: "replay stopped" });
  }

  send(msg: ipc.IpcToPlugin): void {
    if (msg.t === "in" && this.running) {
      this.emit({ t: "in.ack", seq: msg.seq, frame: 0, ok: false });
    }
  }

  setSpeed(x: number): void {
    this._speed = clampSpeed(x);
  }

  pause(): void {
    this._paused = true;
  }

  resume(): void {
    this._paused = false;
    this.lastWall = performance.now();
  }

  /** Przeskocz do `ms` nagrania; emituje spójny stan (hello, cfg, pełny tel) z tego punktu. */
  seek(ms: number): void {
    if (!this.running) return;
    this.seekInternal(Math.max(0, Math.min(ms, this.recording.durationMs)));
  }

  // ───────────────────────────── internals ─────────────────────────────

  private emit(m: SourceMsg): void {
    for (const h of this.handlers) h(m);
  }

  private seekInternal(ms: number): void {
    this.playhead = ms;
    this._ended = false;
    if (ms <= 0) {
      // początek nagrania: odtwórz wszystko z ts=0 dosłownie (hello, cfg, pierwszy tel, log…)
      this.idx = 0;
      while (this.idx < this.entries.length && this.entries[this.idx]!.ts <= 0) {
        this.emit(this.entries[this.idx]!.msg as SourceMsg);
        this.idx++;
      }
      return;
    }
    this.idx = this.entries.findIndex((e) => e.ts > ms);
    if (this.idx < 0) this.idx = this.entries.length;
    const snap = stateAt(this.entries, ms);
    if (snap.hello) this.emit(snap.hello);
    for (const c of snap.cfgs) this.emit(c);
    for (const a of snap.inputActive) this.emit(a);
    if (snap.tel) this.emit(snap.tel);
  }

  private tick(): void {
    const now = performance.now();
    if (this._paused || this._ended) {
      this.lastWall = now;
      return;
    }
    this.playhead += (now - this.lastWall) * this._speed;
    this.lastWall = now;
    while (this.idx < this.entries.length && this.entries[this.idx]!.ts <= this.playhead) {
      this.emit(this.entries[this.idx]!.msg as SourceMsg);
      this.idx++;
    }
    if (this.idx >= this.entries.length && this.playhead >= this.recording.durationMs) this.finish();
  }

  private finish(): void {
    this.loops++;
    if (this.loop) {
      this.emit({ t: "disconnected", reason: "replay loop" });
      this.emit({ t: "connected" });
      this.seekInternal(this.startAt);
      return;
    }
    this._ended = true;
    this.emit({ t: "disconnected", reason: "replay ended" });
    this.onEnd?.();
  }

  /** Czy odtwarzane są nagrane zdarzenia połączenia. */
  get faithfulConnection(): boolean {
    return this.faithful;
  }
}

function clampSpeed(x: number): number {
  if (!Number.isFinite(x)) return 1;
  return Math.min(REPLAY_MAX_SPEED, Math.max(REPLAY_MIN_SPEED, x));
}
