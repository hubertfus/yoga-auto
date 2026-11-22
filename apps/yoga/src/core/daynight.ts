/**
 * Automatyczny tryb nocny wg czasu gry (`time.game` = minuty od początku świata gry).
 * Czysta logika bez Reacta; histereza chroni przed migotaniem przy skokach czasu (sen, teleport, rozjazd zegara).
 * Właściciel: S4.
 */
import type { Settings } from "./settings.ts";

export const MINUTES_PER_DAY = 1440;

export interface NightWindow {
  /** początek nocy, minuta doby (domyślnie 20:00) */
  start: number;
  /** koniec nocy, minuta doby (domyślnie 6:00) */
  end: number;
  /** szerokość histerezy w minutach gry */
  hysteresis: number;
}

export const DEFAULT_NIGHT_WINDOW: NightWindow = { start: 20 * 60, end: 6 * 60, hysteresis: 20 };

const wrap = (m: number) => ((m % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;

/** Minuta doby (0..1439) z czasu gry; null gdy brak sensownych danych. */
export function minuteOfDay(gameMinutes: number | null | undefined): number | null {
  if (gameMinutes == null || !Number.isFinite(gameMinutes)) return null;
  return wrap(Math.floor(gameMinutes));
}

/** Czy minuta doby `m` mieści się w oknie [from, to) przechodzącym przez północ. */
export function inWindow(m: number, from: number, to: number): boolean {
  const f = wrap(from);
  const t = wrap(to);
  if (f === t) return false;
  return f < t ? m >= f && m < t : m >= f || m < t;
}

/**
 * Następny stan „noc”: wejście do nocy dopiero w [start, end); wyjście dopiero poza oknem poszerzonym o histerezę
 * ([start−h, end+h)). W strefach przejściowych zostaje poprzedni stan. Brak czasu → bez zmiany.
 */
export function nextNight(
  prev: boolean,
  gameMinutes: number | null | undefined,
  w: NightWindow = DEFAULT_NIGHT_WINDOW,
): boolean {
  const m = minuteOfDay(gameMinutes);
  if (m === null) return prev;
  if (prev) return inWindow(m, w.start - w.hysteresis, w.end + w.hysteresis);
  return inWindow(m, w.start, w.end);
}

export interface Appearance {
  theme: "dark" | "light";
  night: boolean;
}

/**
 * Efektywny wygląd. `theme: "auto"` → noc = ciemny + tryb nocny, dzień = jasny.
 * Ręczny motyw (dark/light) zostaje, a przełącznik „tryb nocny” działa jak dotąd.
 */
export function resolveAppearance(s: Pick<Settings, "theme" | "night">, autoNight: boolean): Appearance {
  if (s.theme === "auto") return { theme: autoNight ? "dark" : "light", night: autoNight || s.night };
  return { theme: s.theme, night: s.night };
}
