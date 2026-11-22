import { useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { MotionConfig } from "motion/react";
import { injectFilters } from "./refraction/filters.ts";
import { parseBurn, startBurn, wantsOverlay } from "./perf/burn.ts";
import type { TierChange } from "./perf/controller.ts";
import { PerfOverlay } from "./perf/overlay.tsx";
import { perfStore, type PerfMode } from "./perf/store.ts";
import type { FrameStats, PerfTier } from "./types.ts";

export { FrameMonitor, computeFrameStats } from "./perf/frameMonitor.ts";
export { PerfTierController, DEFAULT_THRESHOLDS, TIER_ORDER } from "./perf/controller.ts";
export type { TierChange, TierChangeReason, PerfThresholds } from "./perf/controller.ts";
export { perfStore, setTier } from "./perf/store.ts";
export type { PerfReport, PerfSnapshot, PerfMode } from "./perf/store.ts";
export { surfaces, SurfaceRegistry } from "./perf/surfaceRegistry.ts";
export { PerfOverlay } from "./perf/overlay.tsx";

export interface PerfContextValue {
  /** tier faktycznie zastosowany */
  tier: PerfTier;
  /** wybór użytkownika */
  mode: PerfTier | "auto";
  setMode(mode: PerfTier | "auto"): void;
  stats: FrameStats | null;
  /** ostatnia zmiana tieru (powód: degrade/upgrade/manual/battery) */
  lastChange: TierChange | null;
  /** bateria < 20% bez ładowania ogranicza tier do `lite` */
  batteryLimited: boolean;
}

const setMode = (m: PerfMode): void => perfStore.setMode(m);

/** Aktualny tier i statystyki klatek (DESIGN.md §4). Odświeża się przy zmianie tieru i raz na okno 2 s. */
export function usePerfTier(): PerfContextValue {
  const s = useSyncExternalStore(perfStore.subscribe, perfStore.getSnapshot, perfStore.getSnapshot);
  return useMemo(
    () => ({
      tier: s.tier,
      mode: s.mode,
      setMode,
      stats: s.stats,
      lastChange: s.lastChange,
      batteryLimited: s.batteryLimited,
    }),
    [s],
  );
}

export interface GlassProviderProps {
  /** `"auto"` = auto-degradacja z FrameMonitor (start: `high`); tier stały wyłącza auto */
  tier?: PerfTier | "auto";
  theme?: "dark" | "light";
  night?: boolean;
  /** najwyższy tier osiągalny automatycznie (domyślnie `high`; `ultra` ustawiasz ręcznie albo tu) */
  autoCeiling?: PerfTier;
  /** overlay diagnostyczny; domyślnie z `?perf=1` */
  overlay?: boolean;
  children: ReactNode;
}

/**
 * Montuje system szkła: ustawia `data-tier/theme/night` na `<html>`, startuje FrameMonitor + kontroler tierów,
 * dba o obecność hosta filtrów SVG (jeśli shell nie wkleił go do index.html) i `?perf=1` / `?burn=1`.
 */
export function GlassProvider({
  tier = "auto",
  theme = "dark",
  night = false,
  autoCeiling,
  overlay,
  children,
}: GlassProviderProps) {
  useEffect(() => {
    injectFilters();
    perfStore.configure({ mode: tier, ...(autoCeiling ? { ceiling: autoCeiling } : {}) });
    perfStore.start();
    perfStore.applyCurrent();
    return () => perfStore.stop();
  }, [tier, autoCeiling]);

  useEffect(() => {
    const el = document.documentElement;
    el.dataset.theme = theme;
    el.dataset.night = String(night);
  }, [theme, night]);

  const burnMs = typeof location === "undefined" ? 0 : parseBurn(location.search);
  useEffect(() => (burnMs ? startBurn(burnMs) : undefined), [burnMs]);
  const showOverlay = overlay ?? (typeof location !== "undefined" && wantsOverlay(location.search));

  const current = useSyncExternalStore(perfStore.subscribe, perfStore.getSnapshot, perfStore.getSnapshot);
  useTilt(current.tier === "ultra");

  useEffect(() => {
    const g = globalThis as unknown as { __glassPerf?: unknown };
    g.__glassPerf = perfStore;
    return () => {
      delete g.__glassPerf;
    };
  }, []);

  return (
    <MotionConfig reducedMotion="user">
      {children}
      {showOverlay ? <PerfOverlay burnMs={burnMs} /> : null}
    </MotionConfig>
  );
}

/**
 * `ultra`: specular podąża za `--tilt-x/--tilt-y` (−1..1) z pozycji wskaźnika lub żyroskopu.
 * Zapis do `<html>` tylko przy zmianie ≥ 0.02 i najwyżej raz na klatkę.
 */
function useTilt(enabled: boolean): void {
  useEffect(() => {
    const root = document.documentElement;
    if (!enabled) {
      root.style.removeProperty("--tilt-x");
      root.style.removeProperty("--tilt-y");
      return;
    }
    let raf = 0;
    let tx = 0;
    let ty = 0;
    let cx = 0;
    let cy = 0;
    let baseBeta: number | null = null;
    const flush = () => {
      raf = 0;
      cx += (tx - cx) * 0.35;
      cy += (ty - cy) * 0.35;
      root.style.setProperty("--tilt-x", cx.toFixed(3));
      root.style.setProperty("--tilt-y", cy.toFixed(3));
      if (Math.abs(tx - cx) > 0.01 || Math.abs(ty - cy) > 0.01) raf = requestAnimationFrame(flush);
    };
    const target = (x: number, y: number) => {
      if (Math.abs(x - tx) < 0.02 && Math.abs(y - ty) < 0.02) return;
      tx = x;
      ty = y;
      if (!raf) raf = requestAnimationFrame(flush);
    };
    const onPointer = (e: PointerEvent) =>
      target((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1);
    const onOrient = (e: DeviceOrientationEvent) => {
      if (e.gamma == null || e.beta == null) return;
      baseBeta ??= e.beta;
      target(Math.max(-1, Math.min(1, e.gamma / 30)), Math.max(-1, Math.min(1, (e.beta - baseBeta) / 30)));
    };
    window.addEventListener("pointermove", onPointer, { passive: true });
    window.addEventListener("deviceorientation", onOrient, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("deviceorientation", onOrient);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [enabled]);
}
