/**
 * Wygląd (motyw + noc) z ustawień i czasu gry. Zmiany animowane cross-fade'em całej strony
 * (View Transitions API; bez wsparcia / reduced-motion → natychmiast).
 */
import { useEffect, useRef, useState } from "react";
import { minuteOfDay, nextNight, resolveAppearance, type Appearance } from "../core/daynight.ts";
import { useSettings } from "../core/settings.ts";
import { useSlow, useStatus } from "../core/store.ts";

type VT = { startViewTransition?: (cb: () => void) => unknown };

const prefersReduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

function paint(a: Appearance): void {
  const el = document.documentElement;
  el.dataset.theme = a.theme;
  el.dataset.night = String(a.night);
}

export function useAppearance(): Appearance {
  const theme = useSettings((s) => s.theme);
  const night = useSettings((s) => s.night);
  const connected = useStatus().connected;
  // kwantyzacja do 5 min gry: nie renderujemy Appu przy każdej minucie
  const bucket = useSlow((s) => {
    const m = minuteOfDay(s.time.game);
    return m === null ? null : Math.floor(m / 5) * 5;
  });
  const auto = useRef(false);
  if (theme === "auto" && connected) auto.current = nextNight(auto.current, bucket);

  const target = resolveAppearance({ theme, night }, auto.current);
  const [applied, setApplied] = useState<Appearance>(target);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (target.theme === applied.theme && target.night === applied.night) return;
    const vt = document as unknown as VT;
    if (vt.startViewTransition && !prefersReduced()) {
      // DOM musi zmienić się synchronicznie w callbacku; React dogania stan zaraz potem
      vt.startViewTransition(() => paint(target));
    }
    setApplied(target);
  }, [target.theme, target.night]); // eslint-disable-line react-hooks/exhaustive-deps
  return applied;
}
