/**
 * Układ Home: kolejność widgetów (localStorage) i pakowanie w strony 6×3.
 * Zapis z wersją schematu + migracja v1/v2→v3, operacje edytora (M4) i paginacja.
 */
import type { CardSize } from "@yoga-auto/glass-ui";
import { DEFAULT_HOME_LAYOUT, getWidgets, type WidgetDef } from "../core/registry.ts";

export const GRID_COLS = 6;
export const GRID_ROWS = 3;

export interface Placed {
  widget: WidgetDef;
  col: number; // 0-based
  row: number;
  w: number;
  h: number;
}

export type Page = Placed[];

export const sizeOf = (size: CardSize, cols = GRID_COLS, rows = GRID_ROWS): [number, number] => {
  const [w, h] = size.split("x").map(Number) as [number, number];
  return [Math.min(w, cols), Math.min(h, rows)];
};

/**
 * Wersja schematu zapisu układu. v1 = goła tablica id (klucz `home.v1`), v2 = `{ v: 2, ids }` (klucz `home.v2`),
 * v3 = `{ v: 3, ids }` (klucz `home.v3`, siatka 6×3). Migracja do v3 dokłada nowe widgety (`ADDED_IN_V3`).
 */
export const LAYOUT_VERSION = 3;
const KEY_V1 = "yoga-auto.home.v1";
const KEY_V2 = "yoga-auto.home.v2";
const KEY = "yoga-auto.home.v3";

/** Widgety wprowadzone razem z siatką 6×3: mapa trafia na początek, skróty na koniec starego układu. */
export const ADDED_IN_V3: { front: readonly string[]; back: readonly string[] } = {
  front: ["map"],
  back: ["sc.hazard", "sc.parkingBrake", "sc.engine", "sc.beacon", "sc.high", "sc.trip"],
};

/** Stary układ (v1/v2) + nowe widgety v3, bez duplikatów. */
export const migrateToV3 = (old: readonly string[]): string[] => [
  ...new Set([...ADDED_IN_V3.front, ...old, ...ADDED_IN_V3.back]),
];

const isIdList = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

/** Parsuje zapisany układ (v1 lub v2); null = brak / uszkodzony → układ domyślny. Duplikaty są usuwane. */
export function parseLayout(raw: string | null): string[] | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    const ids = isIdList(v) ? v : v && typeof v === "object" && isIdList((v as { ids?: unknown }).ids) ? (v as { ids: string[] }).ids : null;
    return ids ? [...new Set(ids)] : null;
  } catch {
    return null;
  }
}

/** Odczyt z migracją: gdy brak v3, bierze v2 (albo v1) i przepisuje do v3 (stare klucze są usuwane). */
export function loadLayout(): string[] | null {
  try {
    const cur = parseLayout(localStorage.getItem(KEY));
    if (cur) return cur;
    const old = parseLayout(localStorage.getItem(KEY_V2)) ?? parseLayout(localStorage.getItem(KEY_V1));
    if (!old) return null;
    const next = migrateToV3(old);
    saveLayout(next);
    localStorage.removeItem(KEY_V1);
    localStorage.removeItem(KEY_V2);
    return next;
  } catch {
    return null;
  }
}

export function saveLayout(ids: readonly string[] | null): void {
  try {
    if (ids) localStorage.setItem(KEY, JSON.stringify({ v: LAYOUT_VERSION, ids }));
    else {
      localStorage.removeItem(KEY);
      localStorage.removeItem(KEY_V2);
      localStorage.removeItem(KEY_V1);
    }
  } catch {
    /* prywatne okno */
  }
}

/** Reset do `DEFAULT_HOME_LAYOUT` (+ dodatkowe widgety na kolejnych stronach). */
export const resetLayout = (): void => saveLayout(null);

// ─── operacje edytora (czyste, niemutujące) ───

/** Przenosi `id` na pozycję `to` (indeks w liście PO usunięciu elementu; poza zakresem = clamp). */
export function moveId(ids: readonly string[], id: string, to: number): string[] {
  const from = ids.indexOf(id);
  if (from < 0) return [...ids];
  const out = ids.filter((x) => x !== id);
  out.splice(Math.max(0, Math.min(out.length, to)), 0, id);
  return out;
}

/** Upuszczenie `id` na kafel `target`: zajmuje jego miejsce (kierunek ruchu decyduje, czy przed czy za). */
export function dropOnId(ids: readonly string[], id: string, target: string): string[] {
  const from = ids.indexOf(id);
  const to = ids.indexOf(target);
  if (from < 0 || to < 0 || from === to) return [...ids];
  return moveId(ids, id, to);
}

/** Upuszczenie na puste miejsce strony: `id` ląduje za ostatnim kaflem tej strony. */
export function dropOnPageEnd(ids: readonly string[], id: string, pageIds: readonly string[]): string[] {
  const rest = ids.filter((x) => x !== id);
  const last = [...pageIds].reverse().find((x) => x !== id);
  const at = last ? rest.indexOf(last) + 1 : rest.length;
  return moveId(ids, id, at);
}

export const removeId = (ids: readonly string[], id: string): string[] => ids.filter((x) => x !== id);

export const addId = (ids: readonly string[], id: string): string[] => (ids.includes(id) ? [...ids] : [...ids, id]);

/** Widgety z rejestru, których nie ma w układzie (lista dla „+”). */
export function addableWidgets(ids: readonly string[], all: readonly WidgetDef[] = getWidgets()): WidgetDef[] {
  const on = new Set(ids);
  return all.filter((w) => !on.has(w.id)).sort((a, b) => a.label.localeCompare(b.label, "pl"));
}

/**
 * Kolejność widgetów: zapisany układ użytkownika albo domyślny (DESIGN §6.1);
 * w trybie domyślnym pozostałe zarejestrowane widgety trafiają na kolejne strony.
 * Id spoza rejestru są pomijane.
 */
export function resolveWidgets(
  saved: readonly string[] | null = loadLayout(),
  all: readonly WidgetDef[] = getWidgets(),
): WidgetDef[] {
  const byId = new Map(all.map((w) => [w.id, w]));
  const rest = all
    .map((w) => w.id)
    .filter((id) => !DEFAULT_HOME_LAYOUT.includes(id))
    .sort();
  const order = saved ?? [...DEFAULT_HOME_LAYOUT, ...rest];
  const seen = new Set<string>();
  const out: WidgetDef[] = [];
  for (const id of order) {
    const w = byId.get(id);
    if (w && !seen.has(id)) {
      seen.add(id);
      out.push(w);
    }
  }
  return out;
}

/** Pakowanie „first-fit” po siatce (domyślnie 6×3): widget w pierwszym wolnym miejscu strony, inaczej nowa strona. */
export function paginate(widgets: readonly WidgetDef[], cols = GRID_COLS, rows = GRID_ROWS): Page[] {
  const pages: { grid: boolean[][]; items: Page }[] = [];
  const newPage = () => {
    const p = {
      grid: Array.from({ length: rows }, () => Array<boolean>(cols).fill(false)),
      items: [] as Page,
    };
    pages.push(p);
    return p;
  };
  const fit = (grid: boolean[][], w: number, h: number): [number, number] | null => {
    for (let r = 0; r + h <= rows; r++)
      for (let c = 0; c + w <= cols; c++) {
        let free = true;
        for (let dr = 0; dr < h && free; dr++) for (let dc = 0; dc < w; dc++) if (grid[r + dr]![c + dc]) free = false;
        if (free) return [r, c];
      }
    return null;
  };
  for (const widget of widgets) {
    const [w, h] = sizeOf(widget.size, cols, rows);
    let page = pages.at(-1) ?? newPage();
    let pos = fit(page.grid, w, h);
    if (!pos) {
      page = newPage();
      pos = fit(page.grid, w, h);
    }
    if (!pos) continue; // niemożliwe (w,h ≤ siatka), ale bez crasha
    const [row, col] = pos;
    for (let dr = 0; dr < h; dr++) for (let dc = 0; dc < w; dc++) page.grid[row + dr]![col + dc] = true;
    page.items.push({ widget, col, row, w, h });
  }
  return pages.map((p) => p.items);
}
