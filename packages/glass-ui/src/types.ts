import type { PerfTier } from "@yoga-auto/design-tokens";

export type { PerfTier };
export type Tone = "on" | "lights" | "beam" | "warn" | "crit" | "accent";
export type Elevation = 1 | 2 | 3;
export type GlassTint = "default" | "strong" | "clear";
export type ButtonSize = "sm" | "md" | "lg" | "xl";
export type CardSize = "1x1" | "2x1" | "2x2" | "4x2";
export type ToastLevel = "info" | "warning" | "critical";

export interface FrameStats {
  p50: number;
  p95: number;
  p99: number;
  fps: number;
  samples: number;
  /** najdłuższa klatka w oknie (ms) */
  max?: number;
  /** klatki dłuższe niż 1.5× mediana (pominięty vsync) */
  dropped?: number;
}
