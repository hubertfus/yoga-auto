/**
 * Układ ekranu „Jazda” wybierany przez kierowcę: które elementy widać, skala prędkościomierza, pola panelu trasy,
 * małe zegary i przyciski na dole. Zapis lokalny na urządzeniu (localStorage); błędy storage ignorujemy.
 */
import { useSyncExternalStore } from "react";
import { ACTIONS, type ActionId } from "@yoga-auto/protocol";

export const FACTS = [
  { id: "remaining", label: "Do celu" },
  { id: "arrival", label: "Przyjazd" },
  { id: "clock", label: "Godzina w grze" },
  { id: "rest", label: "Odpoczynek" },
  { id: "job", label: "Cel zlecenia" },
  { id: "retarder", label: "Retarder" },
] as const;
export type FactId = (typeof FACTS)[number]["id"];

export const GAUGES = [
  { id: "fuel", label: "Paliwo" },
  { id: "adblue", label: "AdBlue" },
  { id: "air", label: "Powietrze" },
  { id: "water", label: "Płyn chłodzący" },
  { id: "oil", label: "Olej" },
  { id: "battery", label: "Akumulator" },
  { id: "odo", label: "Przebieg i spalanie" },
] as const;
export type GaugeId = (typeof GAUGES)[number]["id"];

/** Akcje, które można dołożyć na dół ekranu (kolejność = kolejność dodania). */
export const ACTION_CHOICES: readonly ActionId[] = (
  [
    "blinker.left",
    "lights.hazard",
    "blinker.right",
    "parkingBrake.toggle",
    "motorBrake.toggle",
    "retarder.down",
    "retarder.up",
    "lights.high",
    "lights.beacon",
    "cruise.set",
    "cruise.resume",
    "diffLock.toggle",
    "liftAxle.toggle",
    "trailer.toggle",
    "engine.toggle",
    "wipers.up",
    "airHorn",
    "camera.cycle",
  ] as ActionId[]
).filter((a) => Boolean(ACTIONS[a]));

export type SpeedRange = "low" | "mid" | "high";

export interface DriveLayout {
  telltales: boolean;
  panel: boolean;
  speedRange: SpeedRange;
  facts: FactId[];
  gauges: GaugeId[];
  actions: ActionId[];
}

export const DEFAULT_LAYOUT: DriveLayout = {
  telltales: true,
  panel: true,
  speedRange: "mid",
  facts: FACTS.map((f) => f.id),
  gauges: GAUGES.map((g) => g.id),
  actions: [],
};

const KEY = "yoga.drive.layout";

/** Odczyt z naprawą: nieznane pola i wartości odrzucone, brakujące z domyślnych. */
export function parseLayout(raw: string | null): DriveLayout {
  let v: Partial<DriveLayout> = {};
  try {
    v = (JSON.parse(raw ?? "null") as Partial<DriveLayout> | null) ?? {};
  } catch {
    v = {};
  }
  const pick = <T extends string>(xs: unknown, allowed: readonly T[], def: T[]): T[] =>
    Array.isArray(xs) ? allowed.filter((a) => xs.includes(a)) : def;
  const actions = Array.isArray(v.actions) ? v.actions.filter((a): a is ActionId => ACTION_CHOICES.includes(a)) : DEFAULT_LAYOUT.actions;
  return {
    telltales: typeof v.telltales === "boolean" ? v.telltales : DEFAULT_LAYOUT.telltales,
    panel: typeof v.panel === "boolean" ? v.panel : DEFAULT_LAYOUT.panel,
    speedRange: v.speedRange === "low" || v.speedRange === "high" || v.speedRange === "mid" ? v.speedRange : DEFAULT_LAYOUT.speedRange,
    facts: pick(v.facts, FACTS.map((f) => f.id), DEFAULT_LAYOUT.facts),
    gauges: pick(v.gauges, GAUGES.map((g) => g.id), DEFAULT_LAYOUT.gauges),
    actions: [...new Set(actions)],
  };
}

function load(): DriveLayout {
  try {
    return parseLayout(localStorage.getItem(KEY));
  } catch {
    return DEFAULT_LAYOUT;
  }
}

let current: DriveLayout | null = null;
const listeners = new Set<() => void>();
const get = (): DriveLayout => (current ??= load());

export function updateDriveLayout(patch: Partial<DriveLayout>): void {
  current = { ...get(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* brak storage — układ do przeładowania */
  }
  for (const l of listeners) l();
}

export function resetDriveLayout(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* jw. */
  }
  current = DEFAULT_LAYOUT;
  for (const l of listeners) l();
}

/** Tylko dla testów: wczytaj ponownie ze storage. */
export function reloadDriveLayout(): void {
  current = null;
  for (const l of listeners) l();
}

export function useDriveLayout(): DriveLayout {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    get,
    get,
  );
}

/** Przełącza element listy (dodaje na końcu albo usuwa). */
export function toggleIn<T>(xs: readonly T[], x: T): T[] {
  return xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x];
}

type ListKey = "facts" | "gauges" | "actions";
/** Przełącza element listy układu na bieżącym stanie (kilka szybkich stuknięć nie gubi zmian). */
export function toggleLayoutItem<K extends ListKey>(key: K, item: DriveLayout[K][number]): void {
  updateDriveLayout({ [key]: toggleIn(get()[key] as readonly DriveLayout[K][number][], item) } as Partial<DriveLayout>);
}
