import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { FrameStats, PerfTier } from "./types.ts";

/** F0: prosty monitor rAF. S3: okna 2 s, p95, histereza, limit powierzchni (DESIGN.md §5). */
export class FrameMonitor {
  private times: number[] = [];
  private last = 0;
  private raf = 0;
  private listeners = new Set<(s: FrameStats) => void>();

  start(): void {
    const tick = (t: number) => {
      if (this.last) this.times.push(t - this.last);
      this.last = t;
      if (this.times.length >= 120) this.flush();
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
  }

  onStats(cb: (s: FrameStats) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private flush(): void {
    const s = [...this.times].sort((a, b) => a - b);
    const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0;
    const stats: FrameStats = {
      p50: q(0.5),
      p95: q(0.95),
      p99: q(0.99),
      fps: 1000 / (q(0.5) || 16.7),
      samples: s.length,
    };
    this.times = [];
    this.listeners.forEach((l) => l(stats));
  }
}

export interface PerfContextValue {
  /** tier faktycznie zastosowany */
  tier: PerfTier;
  /** wybór użytkownika */
  mode: PerfTier | "auto";
  setMode(mode: PerfTier | "auto"): void;
  stats: FrameStats | null;
}

const PerfContext = createContext<PerfContextValue>({ tier: "high", mode: "auto", setMode: () => {}, stats: null });
export const usePerfTier = (): PerfContextValue => useContext(PerfContext);

export interface GlassProviderProps {
  tier?: PerfTier | "auto";
  theme?: "dark" | "light";
  night?: boolean;
  children: ReactNode;
}

export function GlassProvider({ tier = "auto", theme = "dark", night = false, children }: GlassProviderProps) {
  const [mode, setMode] = useState<PerfTier | "auto">(tier);
  const [stats, setStats] = useState<FrameStats | null>(null);
  const effective: PerfTier = mode === "auto" ? "high" : mode;

  useEffect(() => setMode(tier), [tier]);
  useEffect(() => {
    const el = document.documentElement;
    el.dataset.tier = effective;
    el.dataset.theme = theme;
    el.dataset.night = String(night);
  }, [effective, theme, night]);
  useEffect(() => {
    const m = new FrameMonitor();
    const off = m.onStats(setStats);
    m.start();
    return () => {
      off();
      m.stop();
    };
  }, []);

  return <PerfContext.Provider value={{ tier: effective, mode, setMode, stats }}>{children}</PerfContext.Provider>;
}
