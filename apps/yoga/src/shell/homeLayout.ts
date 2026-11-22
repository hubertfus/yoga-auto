/**
 * Układ Home: kolejność widgetów (localStorage) i pakowanie w strony 4×2.
 * Edytor układu (drag & drop) to M4; tu: odczyt/zapis i paginacja.
 */
import type { CardSize } from "@yoga-auto/glass-ui";
import { DEFAULT_HOME_LAYOUT, getWidgets, type WidgetDef } from "../core/registry.ts";

export const GRID_COLS = 4;
export const GRID_ROWS = 2;
const KEY = "yoga-auto.home.v1";

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

export function loadLayout(): string[] | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : null;
  } catch {
    return null;
  }
}

export function saveLayout(ids: readonly string[] | null): void {
  try {
    if (ids) localStorage.setItem(KEY, JSON.stringify(ids));
    else localStorage.removeItem(KEY);
  } catch {
    /* prywatne okno */
  }
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
