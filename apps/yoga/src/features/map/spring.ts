/** Prosty integrator sprężyny (półjawny Euler z podkrokami) do płynnego markera; niezależny od Reacta i rAF. */

export interface Spring1D {
  x: number;
  v: number;
}

export interface SpringParams {
  stiffness: number;
  damping: number;
  mass?: number;
}

/** Jeden krok o `dt` sekund w stronę `target`. Podkroki ≤ 1/240 s dla stabilności przy sztywnych sprężynach. */
export function springStep(s: Spring1D, target: number, dt: number, p: SpringParams): Spring1D {
  const m = p.mass ?? 1;
  const n = Math.max(1, Math.ceil(dt / (1 / 240)));
  const h = dt / n;
  let { x, v } = s;
  for (let i = 0; i < n; i++) {
    const a = (-p.stiffness * (x - target) - p.damping * v) / m;
    v += a * h;
    x += v * h;
  }
  return { x, v };
}

/** Najkrótsza droga kątowa: zwraca `target` przesunięte o wielokrotność 360°, tak by leżało w ±180° od `current`. */
export function unwrapAngle(current: number, target: number): number {
  let d = (target - current) % 360;
  if (d > 180) d -= 360;
  else if (d < -180) d += 360;
  return current + d;
}

export const normalizeBearing = (deg: number): number => ((deg % 360) + 360) % 360;
