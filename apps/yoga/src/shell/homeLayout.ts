/**
 * Układ Home: kolejność widgetów (localStorage) i pakowanie w strony 4×2.
 * Zapis z wersją schematu + migracja v1→v2, operacje edytora (M4) i paginacja.
 */
import type { CardSize } from "@yoga-auto/glass-ui";
import { DEFAULT_HOME_LAYOUT, getWidgets, type WidgetDef } from "../core/registry.ts";

export const GRID_COLS = 4;
export const GRID_ROWS = 2;

export interface Placed {
  widget: WidgetDef;
  col: number; // 0-based
  row: number;
  w: number;
  h: number;
}

export type Page = Placed[];

export const sizeOf = (size: CardSize): [number, number] => {
  const [w, h] = size.split("x").map(Number) as [number, number];
  return [Math.min(w, GRID_COLS), Math.min(h, GRID_ROWS)];
};

/** Wersja schematu zapisu układu. v1 = goła tablica id (klucz `home.v1`), v2 = `{ v: 2, ids }` (klucz `home.v2`). */
export const LAYOUT_VERSION = 2;
const KEY_V1 = "yoga-auto.home.v1";
const KEY = "yoga-auto.home.v2";

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

/** Odczyt z migracją: gdy brak v2, bierze v1 i przepisuje do v2 (v1 zostaje usunięty). */
export function loadLayout(): string[] | null {
  try {
    const cur = parseLayout(localStorage.getItem(KEY));
    if (cur) return cur;
    const old = parseLayout(localStorage.getItem(KEY_V1));
    if (old) {
      saveLayout(old);
      localStorage.removeItem(KEY_V1);
    }
    return old;
  } catch {
    return null;
  }
}

export function saveLayout(ids: readonly string[] | null): void {
  try {
    if (ids) localStorage.setItem(KEY, JSON.stringify({ v: LAYOUT_VERSION, ids }));
    else {
      localStorage.removeItem(KEY);
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

/** Pakowanie „first-fit” po siatce 4×2: widget w pierwszym wolnym miejscu strony, inaczej nowa strona. */
export function paginate(widgets: readonly WidgetDef[]): Page[] {
  const pages: { grid: boolean[][]; items: Page }[] = [];
  const newPage = () => {
    const p = {
      grid: Array.from({ length: GRID_ROWS }, () => Array<boolean>(GRID_COLS).fill(false)),
      items: [] as Page,
    };
    pages.push(p);
    return p;
  };
  const fit = (grid: boolean[][], w: number, h: number): [number, number] | null => {
    for (let r = 0; r + h <= GRID_ROWS; r++)
      for (let c = 0; c + w <= GRID_COLS; c++) {
        let free = true;
        for (let dr = 0; dr < h && free; dr++) for (let dc = 0; dc < w; dc++) if (grid[r + dr]![c + dc]) free = false;
        if (free) return [r, c];
      }
    return null;
  };
  for (const widget of widgets) {
    const [w, h] = sizeOf(widget.size);
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
