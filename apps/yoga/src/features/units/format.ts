/**
 * Formatery jednostek (czyste funkcje). Protokół jest w SI (m/s, m, l, °C, minuty gry) —
 * konwersja i zapis dla użytkownika dzieją się wyłącznie tutaj, zależnie od `Settings.units`.
 */
import type { Units } from "../../core/settings.ts";

export const MS_TO_KMH = 3.6;
export const MS_TO_MPH = 2.2369362920544;
export const L_TO_GAL = 0.264172052;
export const KM_TO_MI = 0.621371192;
export const PSI_TO_BAR = 0.0689475729;

const DASH = "–";
const finite = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);

/** m/s → liczba w km/h albo mph (bez zaokrąglenia). */
export const speedValue = (ms: number, u: Pick<Units, "speed">): number => ms * (u.speed === "mph" ? MS_TO_MPH : MS_TO_KMH);
export const speedLabel = (u: Pick<Units, "speed">): string => (u.speed === "mph" ? "mph" : "km/h");

/** Prędkość całkowita („87”); wartość nieznana → „–”. Wartości ujemne (cofanie) pokazujemy bez znaku. */
export function formatSpeed(ms: number | null | undefined, u: Pick<Units, "speed">): string {
  if (!finite(ms)) return DASH;
  return String(Math.abs(Math.round(speedValue(ms, u))));
}

/** Limit prędkości: 0 (= brak/nieznany) → „–”. */
export function formatLimit(ms: number | null | undefined, u: Pick<Units, "speed">): string {
  if (!finite(ms) || ms <= 0.1) return DASH;
  return String(Math.round(speedValue(ms, u)));
}

/** Objętość: litry → l albo galony US (1 miejsce po przecinku dla gal). */
export function volumeValue(liters: number, u: Pick<Units, "volume">): number {
  return u.volume === "gal" ? liters * L_TO_GAL : liters;
}
export function formatVolume(liters: number | null | undefined, u: Pick<Units, "volume">): string {
  if (!finite(liters)) return DASH;
  const v = volumeValue(liters, u);
  return u.volume === "gal" ? v.toFixed(1) : String(Math.round(v));
}
export const volumeLabel = (u: Pick<Units, "volume">): string => (u.volume === "gal" ? "gal" : "l");

/** Temperatura: °C → °C albo °F. */
export function tempValue(c: number, u: Pick<Units, "temp">): number {
  return u.temp === "f" ? (c * 9) / 5 + 32 : c;
}
export function formatTemp(c: number | null | undefined, u: Pick<Units, "temp">): string {
  if (!finite(c)) return DASH;
  return `${Math.round(tempValue(c, u))}°${u.temp === "f" ? "F" : "C"}`;
}

/** Dystans: metry → km (mi dla mph). Zawsze liczba z jednostką: „184 km”, „6,4 km” (<10 km → 1 miejsce). */
export function formatDistance(m: number | null | undefined, u: Pick<Units, "speed">): string {
  if (!finite(m)) return DASH;
  const imperial = u.speed === "mph";
  const v = (m / 1000) * (imperial ? KM_TO_MI : 1);
  const unit = imperial ? "mi" : "km";
  if (v < 10) return `${v.toFixed(1).replace(".", ",")} ${unit}`;
  return `${Math.round(v)} ${unit}`;
}
/** km (np. zasięg z gry, odometr) → tekst z jednostką. */
export const formatKm = (km: number | null | undefined, u: Pick<Units, "speed">): string =>
  formatDistance(finite(km) ? km * 1000 : km, u);

/** Zużycie paliwa: l/100 km (kmh) albo mpg (mph/gal). */
export function formatConsumption(lPer100: number | null | undefined, u: Units): string {
  if (!finite(lPer100) || lPer100 <= 0) return DASH;
  if (u.speed === "mph" && u.volume === "gal") return `${(235.215 / lPer100).toFixed(1)} mpg`;
  if (u.volume === "gal") return `${(volumeValue(lPer100, u)).toFixed(1)} gal/100 ${u.speed === "mph" ? "mi" : "km"}`;
  return `${lPer100.toFixed(1)} l/100 ${u.speed === "mph" ? "mi" : "km"}`;
}

/** Sekundy → „2 h 03”, „45 min”, „<1 min”. Ujemne → z minusem („−0 h 12” zapisujemy jako „−12 min”). */
export function formatDuration(seconds: number | null | undefined): string {
  if (!finite(seconds)) return DASH;
  const neg = seconds < 0;
  const total = Math.round(Math.abs(seconds) / 60); // minuty
  const h = Math.floor(total / 60);
  const m = total % 60;
  const sign = neg ? "−" : "";
  if (h === 0) return total === 0 ? (neg ? "−<1 min" : "<1 min") : `${sign}${m} min`;
  return `${sign}${h} h ${String(m).padStart(2, "0")}`;
}
/** Minuty → jak wyżej. */
export const formatMinutes = (min: number | null | undefined): string =>
  formatDuration(finite(min) ? min * 60 : min);

const DAYS = ["pn", "wt", "śr", "cz", "pt", "sb", "nd"] as const;
const pad2 = (n: number) => String(n).padStart(2, "0");

/** Minuty gry (od poniedziałku 00:00) → „wt 16:00”. */
export function formatGameTime(gameMin: number | null | undefined, withDay = true): string {
  if (!finite(gameMin)) return DASH;
  const m = Math.floor(gameMin);
  const day = Math.floor(m / 1440);
  const inDay = ((m % 1440) + 1440) % 1440;
  const hhmm = `${pad2(Math.floor(inDay / 60))}:${pad2(inDay % 60)}`;
  return withDay ? `${DAYS[((day % 7) + 7) % 7]} ${hhmm}` : hhmm;
}

/** Godzina przyjazdu w czasie gry: teraz + ETA (sekundy czasu gry = realne × skala już uwzględnione przez GPS gry). */
export function formatArrival(gameNowMin: number | null | undefined, etaSeconds: number | null | undefined): string {
  if (!finite(gameNowMin) || !finite(etaSeconds)) return DASH;
  return formatGameTime(gameNowMin + etaSeconds / 60, false);
}

/** Waluta gry (EUR): „€18 450”, spacje twarde jako separator tysięcy. */
export function formatMoney(amount: number | null | undefined): string {
  if (!finite(amount)) return DASH;
  const n = Math.round(amount);
  const s = Math.abs(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, "\u00a0");
  return `${n < 0 ? "−" : ""}€${s}`;
}

/** Ułamek 0..1 → „63%”; jedno miejsce dla małych wartości (<10%) gdy `precise`. */
export function formatPercent(fraction: number | null | undefined, precise = false): string {
  if (!finite(fraction)) return DASH;
  const p = fraction * 100;
  return precise && p < 10 ? `${p.toFixed(1).replace(".", ",")}%` : `${Math.round(p)}%`;
}

/** Masa: kg → „18 t” / „950 kg”. */
export function formatMass(kg: number | null | undefined): string {
  if (!finite(kg)) return DASH;
  if (kg >= 1000) return `${(kg / 1000).toFixed(kg % 1000 === 0 ? 0 : 1).replace(".", ",")} t`;
  return `${Math.round(kg)} kg`;
}

/** Ciśnienie psi → „118 psi” (nie podlega ustawieniom; SDK podaje psi). */
export const formatPressure = (psi: number | null | undefined): string =>
  finite(psi) ? `${Math.round(psi)} psi` : DASH;
