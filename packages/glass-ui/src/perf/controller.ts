/**
 * PerfTierController — auto-degradacja tierów z histerezą (DESIGN.md §5, ANALYSIS.md §4.3).
 *
 * Czysta maszyna stanów: dostaje okna statystyk (`push`) i zwraca zmianę tieru. Czas jest wstrzykiwany
 * (`now`), więc test histerezy działa na fake timerach bez rAF.
 *
 * Reguły:
 *  - w dół: p95 > próg (ultra/high 18 ms, lite 22 ms) przez 2 kolejne okna → tier niżej;
 *  - w górę: p95 < próg „dobrych klatek” nieprzerwanie przez 30 s, najwyżej raz na 5 min, nigdy ponad sufit;
 *  - kara za flapping: jeśli tier, na który awansowaliśmy, spadnie w ciągu 2 min, jest blokowany na 30 min;
 *  - bateria < 20% bez ładowania → sufit `lite` (tylko w trybie auto);
 *  - tryb ręczny (`mode` ≠ "auto") wyłącza auto-degradację.
 *
 * Odstępstwo od DESIGN.md: próg „dobrej klatki” 12 ms jest nieosiągalny na panelu 60 Hz, bo rAF dostarcza klatki
 * co 16.7 ms. Dlatego próg wzrostu to max(12, odświeżanie + 0.8 ms), z górnym ograniczeniem 17.6 ms,
 * czyli zawsze poniżej progu degradacji 18 ms (histereza zostaje).
 */
import type { FrameStats, PerfTier } from "../types.ts";

/** od najniższego do najwyższego */
export const TIER_ORDER = ["flat", "lite", "high", "ultra"] as const satisfies readonly PerfTier[];

export const tierIndex = (t: PerfTier): number => TIER_ORDER.indexOf(t);
export const tierBelow = (t: PerfTier): PerfTier | null => TIER_ORDER[tierIndex(t) - 1] ?? null;
export const tierAbove = (t: PerfTier): PerfTier | null => TIER_ORDER[tierIndex(t) + 1] ?? null;
export const minTier = (a: PerfTier, b: PerfTier): PerfTier => (tierIndex(a) <= tierIndex(b) ? a : b);

export interface PerfThresholds {
  /** p95 (ms), powyżej którego tier jest za ciężki; `null` = brak dalszej degradacji */
  down: Record<PerfTier, number | null>;
  /** liczba kolejnych złych okien przed degradacją */
  downWindows: number;
  /** minimalny próg „dobrych klatek” (ms) */
  upMs: number;
  /** jak długo klatki muszą być dobre przed awansem */
  upHoldMs: number;
  /** min. odstęp między awansami */
  upCooldownMs: number;
  /** po jakim czasie spadek po awansie liczy się jako flapping */
  flapWindowMs: number;
  /** na jak długo blokujemy tier, który flapował */
  banMs: number;
  /** długość okna FrameMonitor (ms) */
  windowMs: number;
}

export const DEFAULT_THRESHOLDS: PerfThresholds = {
  down: { ultra: 18, high: 18, lite: 22, flat: null },
  downWindows: 2,
  upMs: 12,
  upHoldMs: 30_000,
  upCooldownMs: 5 * 60_000,
  flapWindowMs: 2 * 60_000,
  banMs: 30 * 60_000,
  windowMs: 2000,
};

export type TierChangeReason = "degrade" | "upgrade" | "manual" | "battery" | "battery-lifted";

export interface TierChange {
  from: PerfTier;
  to: PerfTier;
  reason: TierChangeReason;
  stats?: FrameStats;
}

export interface PerfControllerOptions {
  initial?: PerfTier;
  /** najwyższy tier, do którego auto może awansować (domyślnie `high`; `ultra` tylko ręcznie) */
  ceiling?: PerfTier;
  mode?: PerfTier | "auto";
  thresholds?: Partial<PerfThresholds>;
  now?: () => number;
}

export class PerfTierController {
  private _tier: PerfTier;
  private _mode: PerfTier | "auto";
  private _ceiling: PerfTier;
  private batteryCap: PerfTier | null = null;
  private readonly th: PerfThresholds;
  private readonly now: () => number;
  private badStreak = 0;
  private goodSince: number | null = null;
  private lastUpgradeAt = -Infinity;
  private lastUpgradeTo: PerfTier | null = null;
  private readonly banned = new Map<PerfTier, number>();
  private readonly listeners = new Set<(c: TierChange) => void>();

  constructor(opts: PerfControllerOptions = {}) {
    this.th = { ...DEFAULT_THRESHOLDS, ...opts.thresholds, down: { ...DEFAULT_THRESHOLDS.down, ...opts.thresholds?.down } };
    this.now = opts.now ?? (() => performance.now());
    this._ceiling = opts.ceiling ?? "high";
    this._mode = opts.mode ?? "auto";
    this._tier = this._mode === "auto" ? (opts.initial ?? "high") : this._mode;
  }

  get tier(): PerfTier {
    return this._tier;
  }
  get mode(): PerfTier | "auto" {
    return this._mode;
  }
  get ceiling(): PerfTier {
    return this._ceiling;
  }

  onChange(cb: (c: TierChange) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** Efektywny sufit auto-awansu (sufit użytkownika ∧ bateria). */
  effectiveCeiling(): PerfTier {
    return this.batteryCap ? minTier(this._ceiling, this.batteryCap) : this._ceiling;
  }

  /** Czy tier jest czasowo zablokowany po flappingu. */
  isBanned(tier: PerfTier): boolean {
    const until = this.banned.get(tier);
    return until !== undefined && this.now() < until;
  }

  setMode(mode: PerfTier | "auto"): TierChange | null {
    this._mode = mode;
    this.resetCounters();
    if (mode === "auto") {
      // zostajemy na bieżącym tierze, ale w granicach sufitu
      const cap = this.effectiveCeiling();
      return tierIndex(this._tier) > tierIndex(cap) ? this.move(cap, "manual") : null;
    }
    return this.move(mode, "manual");
  }

  setCeiling(ceiling: PerfTier): TierChange | null {
    this._ceiling = ceiling;
    return this.enforceCeiling("degrade");
  }

  /** Bateria < 20% i brak ładowania → sufit `lite` (tylko tryb auto). */
  setBatteryLow(low: boolean): TierChange | null {
    const prev = this.batteryCap;
    this.batteryCap = low ? "lite" : null;
    if (low && !prev) return this._mode === "auto" ? this.enforceCeiling("battery") : null;
    return null;
  }

  /** Okno statystyk z FrameMonitor. Zwraca zmianę tieru, jeśli zaszła. */
  push(stats: FrameStats): TierChange | null {
    if (this._mode !== "auto") return null;
    const now = this.now();
    const downMs = this.th.down[this._tier];

    // 1. degradacja
    if (downMs !== null && stats.p95 > downMs) {
      this.goodSince = null;
      this.badStreak++;
      if (this.badStreak >= this.th.downWindows) {
        const below = tierBelow(this._tier);
        if (below) {
          if (this.lastUpgradeTo === this._tier && now - this.lastUpgradeAt < this.th.flapWindowMs) {
            this.banned.set(this._tier, now + this.th.banMs);
          }
          return this.move(below, "degrade", stats);
        }
      }
      return null;
    }
    this.badStreak = 0;

    // 2. awans: czy okno jest „dobre”?
    if (stats.p95 >= this.goodThreshold(stats)) {
      this.goodSince = null;
      return null;
    }
    this.goodSince ??= now - this.th.windowMs;
    const above = tierAbove(this._tier);
    if (
      above &&
      tierIndex(above) <= tierIndex(this.effectiveCeiling()) &&
      !this.isBanned(above) &&
      now - this.goodSince >= this.th.upHoldMs &&
      now - this.lastUpgradeAt >= this.th.upCooldownMs
    ) {
      this.lastUpgradeAt = now;
      this.lastUpgradeTo = above;
      return this.move(above, "upgrade", stats);
    }
    return null;
  }

  /** Próg „dobrej klatki” dla okna: max(12, odświeżanie + 0.8), nie więcej niż 17.6 ms. */
  goodThreshold(stats: FrameStats): number {
    return Math.min(17.6, Math.max(this.th.upMs, stats.p50 + 0.8));
  }

  private enforceCeiling(reason: TierChangeReason): TierChange | null {
    const cap = this.effectiveCeiling();
    if (this._mode === "auto" && tierIndex(this._tier) > tierIndex(cap)) return this.move(cap, reason);
    return null;
  }

  private resetCounters(): void {
    this.badStreak = 0;
    this.goodSince = null;
  }

  private move(to: PerfTier, reason: TierChangeReason, stats?: FrameStats): TierChange | null {
    this.resetCounters();
    if (to === this._tier) return null;
    const change: TierChange = { from: this._tier, to, reason, ...(stats ? { stats } : {}) };
    this._tier = to;
    this.listeners.forEach((l) => l(change));
    return change;
  }
}
