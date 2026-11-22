import { useEffect, useRef } from "react";
import type { Story } from "./ladleTypes.ts";
import { GlassCard, Numeric, type ValueHandle } from "../index.ts";
import { Stage } from "./Stage.tsx";
import type { PerfTier } from "../types.ts";

/** 20 kart, każda z liczbą zmienianą 60×/s przez `setValue` (bez re-renderu Reacta). */
function StressGrid({ cards = 20 }: { cards?: number }) {
  const refs = useRef<(ValueHandle | null)[]>([]);
  useEffect(() => {
    let raf = 0;
    const tick = (t: number) => {
      refs.current.forEach((h, i) => h?.setValue(Math.abs(Math.sin(t / 900 + i)) * 1000));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 16, paddingLeft: 0 }}>
      {Array.from({ length: cards }, (_, i) => (
        <GlassCard key={i} size="1x1" accent={`oklch(72% 0.17 ${(i * 37) % 360})`} onPress={() => {}}>
          <div style={{ fontSize: 14, opacity: 0.8 }}>Kanał {i + 1}</div>
          <Numeric ref={(h) => void (refs.current[i] = h)} className="lg-display" format={(v) => v.toFixed(0)} />
        </GlassCard>
      ))}
    </div>
  );
}

const stress = (tier: PerfTier | "auto"): Story => {
  const S: Story = () => (
    <Stage tier={tier} wallpaper="checker">
      <StressGrid />
    </Stage>
  );
  S.storyName = `stress 20 kart @ ${tier}`;
  return S;
};

export default { title: "Stress" };
export const High = stress("high");
export const Ultra = stress("ultra");
export const Lite = stress("lite");
export const Flat = stress("flat");
export const Auto = stress("auto");
