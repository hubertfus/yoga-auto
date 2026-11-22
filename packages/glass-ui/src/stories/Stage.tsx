import type { CSSProperties, ReactNode } from "react";
import { GlassProvider } from "../perf.tsx";
import type { PerfTier } from "../types.ts";
import "../styles.css";

/** Trzy tapety testowe do sprawdzania kontrastu i refrakcji (jasna, ciemna, wysokiej częstotliwości). */
export type Wallpaper = "aurora" | "dusk" | "checker";

const WALLPAPERS: Record<Wallpaper, CSSProperties> = {
  aurora: {
    background:
      "radial-gradient(60% 50% at 20% 20%, oklch(75% 0.17 200) 0%, transparent 70%)," +
      "radial-gradient(50% 60% at 85% 30%, oklch(70% 0.2 320) 0%, transparent 70%)," +
      "radial-gradient(70% 50% at 50% 100%, oklch(80% 0.17 95) 0%, transparent 70%), oklch(30% 0.05 260)",
  },
  dusk: {
    background:
      "radial-gradient(70% 60% at 30% 10%, oklch(45% 0.12 260) 0%, transparent 70%)," +
      "linear-gradient(160deg, oklch(22% 0.04 270), oklch(14% 0.02 250))",
  },
  // ostre krawędzie i wysoka częstotliwość: refrakcja jest tu najlepiej widoczna, a kontrast najgorszy
  checker: {
    backgroundColor: "oklch(85% 0.02 90)",
    backgroundImage:
      "conic-gradient(oklch(20% 0.02 260) 25%, transparent 0 50%, oklch(20% 0.02 260) 0 75%, transparent 0)",
    backgroundSize: "64px 64px",
  },
};

export interface StageProps {
  tier?: PerfTier | "auto";
  wallpaper?: Wallpaper;
  theme?: "dark" | "light";
  night?: boolean;
  /** pokaż overlay fps/tier */
  overlay?: boolean;
  padding?: number;
  children: ReactNode;
}

/** Tapeta testowa + GlassProvider. Każda story jest opakowana w Stage (tier stały albo `auto`). */
export function Stage({ tier = "high", wallpaper = "aurora", theme = "dark", night = false, overlay = true, padding = 24, children }: StageProps) {
  return (
    <GlassProvider tier={tier} theme={theme} night={night} overlay={overlay} autoCeiling="ultra">
      <style>{".lg-display{font-size:72px;line-height:1;font-weight:700}.lg-label{font-size:16px;font-weight:600;opacity:.8}"}</style>
      <div style={{ position: "fixed", inset: 0, overflow: "auto", padding, ...WALLPAPERS[wallpaper] }}>{children}</div>
    </GlassProvider>
  );
}

export const TIERS: readonly PerfTier[] = ["ultra", "high", "lite", "flat"];
export const WALLPAPER_NAMES: readonly Wallpaper[] = ["aurora", "dusk", "checker"];
