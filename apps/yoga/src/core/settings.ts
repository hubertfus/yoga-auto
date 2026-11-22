/**
 * Ustawienia użytkownika (localStorage). Kontrakt dla features: jednostki czyta się przez
 * `useSettings((s) => s.units)` albo `getSettings().units` (formatery w `features/units`, S5).
 * Właściciel: S4.
 */
import { useRef, useSyncExternalStore } from "react";
import type { PerfTier } from "@yoga-auto/glass-ui";

export type SpeedUnit = "kmh" | "mph";
export type TempUnit = "c" | "f";
export type VolumeUnit = "l" | "gal";
export type FastHz = 15 | 30 | 60;

export interface Units {
  speed: SpeedUnit;
  temp: TempUnit;
  volume: VolumeUnit;
}

export interface Settings {
  units: Units;
  theme: "dark" | "light";
  /** tryb nocny: przyciemnienie + cieplejszy akcent (DESIGN §3.1) */
  night: boolean;
  /** tier Liquid Glass; `auto` = FrameMonitor decyduje */
  tier: PerfTier | "auto";
  /** 0.3..1 — nakładka przyciemniająca cały ekran (jasność „programowa”) */
  brightness: number;
  /** częstotliwość kanału fast (subscribe) */
  fastHz: FastHz;
  /** dźwięk dla alertów krytycznych */
  sounds: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  units: { speed: "kmh", temp: "c", volume: "l" },
  theme: "dark",
  night: false,
  tier: "auto",
  brightness: 1,
  fastHz: 30,
  sounds: true,
};

const KEY = "yoga-auto.settings.v1";

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const s = JSON.parse(raw) as Partial<Settings>;
    return { ...DEFAULT_SETTINGS, ...s, units: { ...DEFAULT_SETTINGS.units, ...s.units } };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

let current: Settings = load();
const listeners = new Set<() => void>();

export const getSettings = (): Settings => current;

export function updateSettings(patch: Partial<Omit<Settings, "units">> & { units?: Partial<Units> }): void {
  current = { ...current, ...patch, units: { ...current.units, ...patch.units } };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* prywatne okno */
  }
  listeners.forEach((l) => l());
}

export function resetSettings(): void {
  updateSettings(DEFAULT_SETTINGS);
}

export function subscribeSettings(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Bez selektora: całe ustawienia. Z selektorem: re-render tylko przy zmianie wybranej wartości (płytko). */
export function useSettings(): Settings;
export function useSettings<T>(selector: (s: Settings) => T): T;
export function useSettings<T>(selector?: (s: Settings) => T): T | Settings {
  const cache = useRef<{ src: Settings; v: unknown } | null>(null);
  return useSyncExternalStore(subscribeSettings, () => {
    if (!selector) return current;
    if (cache.current?.src === current) return cache.current.v as T;
    const v = selector(current);
    const prev = cache.current?.v;
    const same =
      prev !== undefined &&
      (Object.is(prev, v) ||
        (typeof v === "object" &&
          v !== null &&
          typeof prev === "object" &&
          prev !== null &&
          Object.keys(v).length === Object.keys(prev).length &&
          Object.keys(v).every((k) => Object.is((v as never)[k], (prev as never)[k]))));
    cache.current = { src: current, v: same ? prev : v };
    return cache.current.v as T;
  });
}
