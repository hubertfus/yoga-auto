/**
 * Generator map przemieszczeń dla refrakcji (DESIGN.md §2, ANALYSIS.md §4.3).
 *
 * Mapa to obraz RGBA, który `feDisplacementMap` czyta jako wektory: R = przesunięcie X, G = przesunięcie Y,
 * 128 = brak przesunięcia. Dla zaokrąglonego prostokąta `w×h×radius` liczymy:
 *   1. odległość znakowaną (SDF) do krawędzi i jej gradient (normalna),
 *   2. głębokość `d` od krawędzi i profil soczewki: przemieszczenie rośnie przy krawędzi (profil „squircle”,
 *      wypukłość (1 − (1 − t)⁴)^¼), a w środku jest zerowe (płasko),
 *   3. kierunek: do wnętrza (próbkujemy tło spod soczewki, a nie spoza elementu, gdzie backdrop jest pusty).
 *
 * Część obliczeniowa jest czysta (bez DOM), żeby dało się ją testować w Node; canvas/data-URL jest osobno.
 */

export interface MapParams {
  /** szerokość / wysokość elementu w CSS px */
  w: number;
  h: number;
  /** promień rogów (CSS px; dla pigułek min(w,h)/2) */
  radius: number;
  /** szerokość strefy załamania (px); domyślnie dobierana z promienia i rozmiaru */
  bezel?: number;
}

export interface RawMap {
  width: number;
  height: number;
  /** RGBA, 4 bajty na piksel, alfa = 255 */
  data: Uint8ClampedArray;
}

/** Maks. liczba pikseli mapy; większe elementy dostają mapę w mniejszej rozdzielczości (rozciąganą przez feImage). */
export const MAX_MAP_PIXELS = 120_000;

/** Klucz cache: `w×h×r` (DESIGN.md: klucz w×h×radius). */
export const mapKey = (w: number, h: number, r: number): string => `${Math.round(w)}x${Math.round(h)}r${Math.round(r)}`;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep = (a: number, b: number, v: number): number => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Profil wypukłości squircle: wysokość powierzchni dla t ∈ [0,1] (0 = krawędź, 1 = koniec bezela). */
export const squircleHeight = (t: number): number => Math.pow(1 - Math.pow(1 - clamp01(t), 4), 0.25);

/**
 * Znormalizowana siła przemieszczenia 0..1 dla `t` (0 = krawędź, 1 = koniec strefy).
 * Pochodna profilu squircle (nachylenie powierzchni ∝ załamanie), obcięta przy samej krawędzi, gdzie dąży do ∞,
 * i wygaszona do 0 ku środkowi.
 */
export function lensStrength(t: number): number {
  const u = clamp01(t);
  if (u >= 1) return 0;
  const slope = Math.pow(1 - u, 3) * Math.pow(Math.max(1 - Math.pow(1 - u, 4), 1e-6), -0.75);
  const norm = Math.min(slope / 3.2, 1);
  const fade = 1 - smoothstep(0.55, 1, u);
  return norm * fade;
}

/** SDF zaokrąglonego prostokąta o środku w (0,0): < 0 wewnątrz. */
export function roundedRectSdf(px: number, py: number, hw: number, hh: number, r: number): number {
  const qx = Math.abs(px) - (hw - r);
  const qy = Math.abs(py) - (hh - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

/** Wymiary mapy po ograniczeniu liczby pikseli. */
export function mapSize(w: number, h: number): { mw: number; mh: number; scale: number } {
  const pixels = w * h;
  const scale = pixels > MAX_MAP_PIXELS ? Math.sqrt(MAX_MAP_PIXELS / pixels) : 1;
  return { mw: Math.max(2, Math.round(w * scale)), mh: Math.max(2, Math.round(h * scale)), scale };
}

export function defaultBezel(w: number, h: number, radius: number): number {
  return Math.max(6, Math.min(Math.min(w, h) / 2, Math.max(radius * 0.9, 18)));
}

export function computeDisplacementMap({ w, h, radius, bezel }: MapParams): RawMap {
  const { mw, mh, scale } = mapSize(w, h);
  const r = Math.min(radius, Math.min(w, h) / 2);
  const bz = bezel ?? defaultBezel(w, h, r);
  const data = new Uint8ClampedArray(mw * mh * 4);
  const hw = w / 2;
  const hh = h / 2;
  const eps = 0.5;
  for (let y = 0; y < mh; y++) {
    const py = (y + 0.5) / scale - hh;
    for (let x = 0; x < mw; x++) {
      const px = (x + 0.5) / scale - hw;
      const sdf = roundedRectSdf(px, py, hw, hh, r);
      const i = (y * mw + x) * 4;
      let vx = 0;
      let vy = 0;
      if (sdf < 0) {
        const mag = lensStrength(-sdf / bz);
        if (mag > 0) {
          // gradient SDF = normalna zewnętrzna; kierunek przemieszczenia do wnętrza
          let gx = roundedRectSdf(px + eps, py, hw, hh, r) - roundedRectSdf(px - eps, py, hw, hh, r);
          let gy = roundedRectSdf(px, py + eps, hw, hh, r) - roundedRectSdf(px, py - eps, hw, hh, r);
          const len = Math.hypot(gx, gy) || 1;
          gx /= len;
          gy /= len;
          vx = -gx * mag;
          vy = -gy * mag;
        }
      }
      data[i] = Math.round(128 + 127 * vx);
      data[i + 1] = Math.round(128 + 127 * vy);
      data[i + 2] = 128;
      data[i + 3] = 255;
    }
  }
  return { width: mw, height: mh, data };
}

/** Wektor przemieszczenia (−1..1) z mapy w punkcie (diagnostyka/testy). */
export function sampleVector(map: RawMap, x: number, y: number): { x: number; y: number } {
  const cx = Math.min(map.width - 1, Math.max(0, x));
  const cy = Math.min(map.height - 1, Math.max(0, y));
  const i = (cy * map.width + cx) * 4;
  return { x: ((map.data[i] ?? 128) - 128) / 127, y: ((map.data[i + 1] ?? 128) - 128) / 127 };
}
