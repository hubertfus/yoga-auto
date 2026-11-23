/**
 * Geometria zegarów ekranu „Jazda” (czyste funkcje): kąty, łuki SVG, podziałki i skale prędkościomierza
 * oraz obrotomierza. Układ: viewBox 200×200, środek (100, 100), kąt 0° = godzina 12, rośnie zgodnie z zegarem.
 */
import type { Units } from "../../core/settings.ts";

export const C = 100;
/** łuk zegara (°): przerwa u dołu na odczyt cyfrowy */
export const ARC = 260;
export const A0 = -ARC / 2;

export const polar = (deg: number, r: number): [number, number] => {
  const a = (deg * Math.PI) / 180;
  return [C + r * Math.sin(a), C - r * Math.cos(a)];
};

/** Wartość → kąt na łuku (przycięta do skali). */
export function angleOf(v: number, min: number, max: number): number {
  const f = max > min ? (Math.min(max, Math.max(min, v)) - min) / (max - min) : 0;
  return A0 + f * ARC;
}

/** Łuk SVG od kąta a0 do a1 na promieniu r. */
export function arcPath(a0: number, a1: number, r: number): string {
  const [x0, y0] = polar(a0, r);
  const [x1, y1] = polar(a1, r);
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

export interface Tick {
  value: number;
  major: boolean;
}

/** Podziałki od min do max: główne co `major`, między nimi `minor` pośrednich. */
export function scaleTicks(min: number, max: number, major: number, minor: number): Tick[] {
  const step = major / (minor + 1);
  const out: Tick[] = [];
  const n = Math.round((max - min) / step);
  for (let i = 0; i <= n; i++) out.push({ value: min + i * step, major: i % (minor + 1) === 0 });
  return out;
}

export interface Scale {
  max: number;
  major: number;
  minor: number;
}

/**
 * Prędkościomierz wg zakresu z układu ekranu: km/h 0–100 / 0–140 / 0–180 co 20 (pośrednie co 10),
 * mph 0–70 / 0–90 co 10 albo 0–120 co 20.
 */
export function speedScale(u: Pick<Units, "speed">, range: "low" | "mid" | "high" = "mid"): Scale {
  if (u.speed === "mph") return range === "low" ? { max: 70, major: 10, minor: 1 } : range === "high" ? { max: 120, major: 20, minor: 1 } : { max: 90, major: 10, minor: 1 };
  return { max: range === "low" ? 100 : range === "high" ? 180 : 140, major: 20, minor: 1 };
}

/** Podpis zakresu do ustawień („0–140”). */
export const speedRangeLabel = (u: Pick<Units, "speed">, range: "low" | "mid" | "high"): string => `0–${speedScale(u, range).max}`;

export interface RpmScale extends Scale {
  /** zakres ekonomicznej jazdy (zielony) */
  eco: [number, number];
  /** od tej wartości czerwone pole */
  red: number;
}

/**
 * Obrotomierz z limitu obrotów silnika (`truck.rpmLimit`, w ETS2 zwykle 2500): skala do pełnych 500 powyżej limitu
 * (co 500, pośrednie co 100), zielone pole ~40–60% limitu (moment obrotowy ciężarówek), czerwone od 90%.
 */
export function rpmScale(rpmLimit: number): RpmScale {
  const limit = rpmLimit > 500 ? rpmLimit : 2500;
  const max = Math.ceil((limit + 250) / 500) * 500;
  const round50 = (v: number) => Math.round(v / 50) * 50;
  return { max, major: 500, minor: 4, eco: [round50(limit * 0.4), round50(limit * 0.6)], red: round50(limit * 0.9) };
}
