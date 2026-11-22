import type { FrameStats } from "../types.ts";

export interface FrameMonitorOptions {
  /** długość okna pomiarowego (ms); DESIGN.md §4: 2 s */
  windowMs?: number;
  /** źródło czasu/rAF do testów */
  raf?: (cb: (t: number) => void) => number;
  caf?: (id: number) => void;
  /** czy karta jest ukryta (okno z ukrytą kartą odrzucamy) */
  isHidden?: () => boolean;
}

/** Kwantyl z posortowanej tablicy (metoda najbliższego rangą). */
export function quantile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
}

/** Statystyki z próbki czasów klatek (ms). Czysta funkcja, używana też w testach i benchmarku. */
export function computeFrameStats(times: readonly number[]): FrameStats {
  const s = [...times].sort((a, b) => a - b);
  const p50 = quantile(s, 0.5);
  const mean = s.length ? s.reduce((a, b) => a + b, 0) / s.length : 0;
  return {
    p50,
    p95: quantile(s, 0.95),
    p99: quantile(s, 0.99),
    fps: mean > 0 ? 1000 / mean : 0,
    samples: s.length,
    max: s.length ? (s[s.length - 1] ?? 0) : 0,
    // klatki dłuższe niż 1.5× mediana = pominięty vsync
    dropped: s.filter((t) => t > Math.max(p50, 4) * 1.5).length,
  };
}

/**
 * Monitor czasu klatek: rAF, okna 2 s, p50/p95/p99. Okna z ukrytą kartą lub przerwą > 1 s (wstrzymany rAF)
 * są odrzucane, żeby uśpienie karty nie degradowało szkła.
 */
export class FrameMonitor {
  private times: number[] = [];
  private last = 0;
  private windowStart = 0;
  private tainted = false;
  private raf = 0;
  private running = false;
  private readonly listeners = new Set<(s: FrameStats) => void>();
  private readonly windowMs: number;
  private readonly requestFrame: (cb: (t: number) => void) => number;
  private readonly cancelFrame: (id: number) => void;
  private readonly isHidden: () => boolean;
  /** ostatnie okno (do overlayu i raportów) */
  latest: FrameStats | null = null;

  constructor(opts: FrameMonitorOptions = {}) {
    this.windowMs = opts.windowMs ?? 2000;
    this.requestFrame = opts.raf ?? ((cb) => requestAnimationFrame(cb));
    this.cancelFrame = opts.caf ?? ((id) => cancelAnimationFrame(id));
    this.isHidden = opts.isHidden ?? (() => typeof document !== "undefined" && document.hidden);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = 0;
    this.windowStart = 0;
    this.times = [];
    this.tainted = false;
    this.raf = this.requestFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    this.cancelFrame(this.raf);
  }

  onStats(cb: (s: FrameStats) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private tick = (t: number): void => {
    if (!this.running) return;
    if (this.isHidden()) this.tainted = true;
    if (this.last) {
      const dt = t - this.last;
      if (dt > 1000) this.tainted = true;
      else this.times.push(dt);
    }
    this.last = t;
    if (!this.windowStart) this.windowStart = t;
    if (t - this.windowStart >= this.windowMs) this.flush(t);
    this.raf = this.requestFrame(this.tick);
  };

  private flush(now: number): void {
    const times = this.times;
    const tainted = this.tainted;
    this.times = [];
    this.tainted = false;
    this.windowStart = now;
    if (tainted || times.length < 10) return;
    const stats = computeFrameStats(times);
    this.latest = stats;
    this.listeners.forEach((l) => l(stats));
  }
}
