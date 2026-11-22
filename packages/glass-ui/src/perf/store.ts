/**
 * Globalny magazyn wydajności: łączy FrameMonitor, PerfTierController, baterię i rejestr powierzchni,
 * i stosuje wynik do DOM (`data-tier`), filtrów (`--refract-scale`) i limitu powierzchni.
 * Czytany przez `usePerfTier()` (useSyncExternalStore). Jeden na stronę.
 */
import { tokens } from "@yoga-auto/design-tokens";
import { refractFilters } from "../refraction/filters.ts";
import type { FrameStats, PerfTier } from "../types.ts";
import { PerfTierController, type TierChange } from "./controller.ts";
import { FrameMonitor } from "./frameMonitor.ts";
import { surfaces } from "./surfaceRegistry.ts";

export type PerfMode = PerfTier | "auto";

export interface PerfSnapshot {
  /** tier faktycznie zastosowany */
  tier: PerfTier;
  /** wybór użytkownika */
  mode: PerfMode;
  stats: FrameStats | null;
  /** ostatnia zmiana tieru (do overlayu) */
  lastChange: TierChange | null;
  /** bateria ogranicza tier do `lite` */
  batteryLimited: boolean;
  /** log zmian tieru (ostatnie 20) — pomocny w raportach benchmarku */
  history: readonly (TierChange & { at: number })[];
}

interface BatteryManagerLike extends EventTarget {
  level: number;
  charging: boolean;
}

export const LOW_BATTERY_LEVEL = 0.2;

export interface PerfReport {
  windows: number;
  seconds: number;
  tier: PerfTier;
  p95Median: number;
  p95Worst: number;
  p99Worst: number;
  fpsMean: number;
  windowsOverBudget: number;
  tierChanges: string[];
}

class PerfStore {
  private snap: PerfSnapshot = { tier: "high", mode: "auto", stats: null, lastChange: null, batteryLimited: false, history: [] };
  private readonly listeners = new Set<() => void>();
  private controller = new PerfTierController();
  private monitor: FrameMonitor | null = null;
  private offs: (() => void)[] = [];
  private started = 0;

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  getSnapshot = (): PerfSnapshot => this.snap;

  get tier(): PerfTier {
    return this.snap.tier;
  }

  /** Ręczny wybór tieru lub `auto`. */
  setMode(mode: PerfMode): void {
    const change = this.controller.setMode(mode);
    this.update({ mode }, change);
  }

  /** Konfiguracja przez GlassProvider; liczy się pierwsze wywołanie po `start`. */
  configure(opts: { mode: PerfMode; ceiling?: PerfTier; initial?: PerfTier }): void {
    const wasRunning = this.started > 0;
    if (!wasRunning) {
      this.controller = new PerfTierController({
        mode: opts.mode,
        ...(opts.ceiling ? { ceiling: opts.ceiling } : {}),
        ...(opts.initial ? { initial: opts.initial } : {}),
      });
      this.snap = { ...this.snap, tier: this.controller.tier, mode: opts.mode, history: [] };
      this.apply(this.controller.tier);
    } else {
      if (opts.ceiling) this.controller.setCeiling(opts.ceiling);
      this.setMode(opts.mode);
    }
  }

  start(): void {
    if (this.started++ > 0) return;
    const monitor = (this.monitor = new FrameMonitor());
    this.offs.push(monitor.onStats((stats) => this.onStats(stats)));
    monitor.start();
    this.offs.push(() => monitor.stop());
    void this.watchBattery();
  }

  stop(): void {
    if (--this.started > 0) return;
    this.started = 0;
    this.offs.forEach((f) => f());
    this.offs = [];
    this.monitor = null;
  }

  /** Wstrzykuje okno statystyk (testy, symulacje, `?burn`). */
  injectStats(stats: FrameStats): void {
    this.onStats(stats);
  }

  private windows: FrameStats[] = [];

  /** Zbiorczy raport z zarejestrowanych okien (do README / benchmarku na Yodze). */
  report(): PerfReport {
    const w = this.windows;
    const p95s = w.map((s) => s.p95).sort((a, b) => a - b);
    const q = (p: number) => p95s[Math.min(p95s.length - 1, Math.floor(p * p95s.length))] ?? 0;
    return {
      windows: w.length,
      seconds: w.length * 2,
      tier: this.snap.tier,
      p95Median: q(0.5),
      p95Worst: p95s[p95s.length - 1] ?? 0,
      p99Worst: Math.max(0, ...w.map((s) => s.p99)),
      fpsMean: w.length ? w.reduce((a, s) => a + s.fps, 0) / w.length : 0,
      windowsOverBudget: w.filter((s) => s.p95 > 16.7 + 0.8).length,
      tierChanges: this.snap.history.map((h) => `${h.from}→${h.to} (${h.reason})`),
    };
  }

  resetReport(): void {
    this.windows = [];
  }

  private onStats(stats: FrameStats): void {
    this.windows = [...this.windows.slice(-299), stats];
    const change = this.controller.push(stats);
    this.update({ stats }, change);
  }

  private update(patch: Partial<PerfSnapshot>, change: TierChange | null): void {
    let next: PerfSnapshot = { ...this.snap, ...patch };
    if (change) {
      next = {
        ...next,
        tier: change.to,
        lastChange: change,
        history: [...next.history, { ...change, at: Date.now() }].slice(-20),
      };
      this.apply(change.to);
      if (typeof document !== "undefined") {
        document.documentElement.dispatchEvent(new CustomEvent("tierchange", { detail: change, bubbles: true }));
      }
    }
    this.snap = next;
    this.listeners.forEach((l) => l());
  }

  /** Stosuje tier do dokumentu, skali refrakcji i limitu powierzchni. */
  private apply(tier: PerfTier): void {
    if (typeof document !== "undefined") document.documentElement.dataset.tier = tier;
    const t = tokens.tier[tier];
    refractFilters.setScale(Number(t["refract-scale"]));
    surfaces.setLimit(Number(t["max-surfaces"]));
  }

  /** Wymusza zastosowanie bieżącego tieru (po zamontowaniu providera). */
  applyCurrent(): void {
    this.apply(this.snap.tier);
  }

  private async watchBattery(): Promise<void> {
    const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryManagerLike> };
    if (typeof nav.getBattery !== "function") return;
    try {
      const bat = await nav.getBattery();
      const check = () => {
        const low = !bat.charging && bat.level < LOW_BATTERY_LEVEL;
        const change = this.controller.setBatteryLow(low);
        this.update({ batteryLimited: low && this.controller.mode === "auto" }, change);
      };
      bat.addEventListener("levelchange", check);
      bat.addEventListener("chargingchange", check);
      this.offs.push(() => {
        bat.removeEventListener("levelchange", check);
        bat.removeEventListener("chargingchange", check);
      });
      check();
    } catch {
      /* brak uprawnień / API — ignorujemy */
    }
  }
}

export const perfStore = new PerfStore();

/** API z DESIGN.md §4: ręczne ustawienie tieru (`"auto"` oddaje sterowanie kontrolerowi). */
export function setTier(mode: PerfMode): void {
  perfStore.setMode(mode);
}
