/** Kamera mapy za pojazdem: tryb widoku (kierunek jazdy w górę, 3D), zapamiętanie i płynne przejścia. */
import { normalizeBearing } from "./spring.ts";

/** Tryb widoku: kierunek jazdy w górę i pochylenie 3D. Zapamiętywany per klucz jak zoom. */
export interface MapViewMode {
  headingUp: boolean;
  tilt: boolean;
}
const NORTH_UP: MapViewMode = { headingUp: false, tilt: false };

export function loadViewMode(key: string | undefined): MapViewMode {
  if (!key) return NORTH_UP;
  try {
    const v = JSON.parse(localStorage.getItem(`yoga.map.view.${key}`) ?? "null") as Partial<MapViewMode> | null;
    return { headingUp: v?.headingUp === true, tilt: v?.tilt === true };
  } catch {
    return NORTH_UP;
  }
}
export function saveViewMode(key: string | undefined, m: MapViewMode): void {
  if (!key) return;
  try {
    localStorage.setItem(`yoga.map.view.${key}`, JSON.stringify(m));
  } catch {
    /* brak storage — tryb tylko do końca widoku */
  }
}

/** Pochylenie widoku 3D (°) i przesunięcie pojazdu w dół (ułamek wysokości mapy przy pełnym pochyleniu). */
export const TILT_PITCH = 55;
export const TILT_SHIFT = 0.3;

/** Krok kamery w stronę trybu: `blend` 0→1 (kierunek jazdy w górę), `pitch` 0→TILT_PITCH; wykładniczo, z domknięciem. */
export function cameraStep(cur: { blend: number; pitch: number }, mode: MapViewMode, dt: number): { blend: number; pitch: number } {
  const k = Math.min(1, dt * 6);
  const go = (x: number, to: number, eps: number) => (Math.abs(to - x) < eps ? to : x + (to - x) * k);
  return { blend: go(cur.blend, mode.headingUp ? 1 : 0, 0.002), pitch: go(cur.pitch, mode.tilt ? TILT_PITCH : 0, 0.05) };
}

/** Obrót kamery dla kursu pojazdu `b` (°) przy częściowym przejściu `blend` (najkrótszą drogą od północy). */
export function cameraBearing(b: number, blend: number): number {
  const s = normalizeBearing(b);
  return normalizeBearing((s > 180 ? s - 360 : s) * blend);
}
