import { computeDisplacementMap, mapKey, type MapParams, type RawMap } from "./displacement.ts";

export type MapRenderer = (map: RawMap) => string;

export interface MapCacheOptions {
  /** maks. liczba map w cache (LRU); mapy z refs > 0 nie są usuwane */
  max?: number;
  /** zamiana surowej mapy na data-URL; domyślnie canvas.toDataURL */
  render?: MapRenderer;
  /** generator surowej mapy (do testów) */
  compute?: (p: MapParams) => RawMap;
}

export interface MapEntry {
  key: string;
  dataUrl: string;
  /** rozmiar elementu, dla którego mapa powstała */
  w: number;
  h: number;
  r: number;
  refs: number;
}

/** RawMap → data-URL PNG przez canvas (przeglądarka). */
export const canvasRenderer: MapRenderer = (map) => {
  const canvas = document.createElement("canvas");
  canvas.width = map.width;
  canvas.height = map.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("glass-ui: brak kontekstu 2d do generowania mapy przemieszczeń");
  const img = ctx.createImageData(map.width, map.height);
  img.data.set(map.data);
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL("image/png");
};

/**
 * Cache map przemieszczeń: klucz `w×h×r`, LRU, liczniki referencji.
 * `acquire` zwraca wpis (generuje, jeśli brak), `release` zwalnia referencję.
 */
export class DisplacementCache {
  private readonly entries = new Map<string, MapEntry>();
  private readonly max: number;
  private readonly render: MapRenderer;
  private readonly compute: (p: MapParams) => RawMap;
  /** licznik wygenerowanych map (diagnostyka/testy) */
  generated = 0;
  /** wywoływane po usunięciu wpisu z cache (rejestr filtrów sprząta wtedy węzły SVG) */
  onEvict?: (key: string) => void;

  constructor(opts: MapCacheOptions = {}) {
    this.max = opts.max ?? 96;
    this.render = opts.render ?? canvasRenderer;
    this.compute = opts.compute ?? computeDisplacementMap;
  }

  get size(): number {
    return this.entries.size;
  }

  has(w: number, h: number, r: number): boolean {
    return this.entries.has(mapKey(w, h, r));
  }

  acquire(w: number, h: number, r: number): MapEntry {
    const key = mapKey(w, h, r);
    let e = this.entries.get(key);
    if (e) {
      this.entries.delete(key); // LRU: na koniec
    } else {
      const rw = Math.round(w);
      const rh = Math.round(h);
      const rr = Math.round(r);
      e = { key, dataUrl: this.render(this.compute({ w: rw, h: rh, radius: rr })), w: rw, h: rh, r: rr, refs: 0 };
      this.generated++;
    }
    e.refs++;
    this.entries.set(key, e);
    this.evict();
    return e;
  }

  release(key: string): void {
    const e = this.entries.get(key);
    if (e && e.refs > 0) e.refs--;
    this.evict();
  }

  clear(): void {
    for (const key of this.entries.keys()) this.onEvict?.(key);
    this.entries.clear();
  }

  private evict(): void {
    if (this.entries.size <= this.max) return;
    for (const [key, e] of this.entries) {
      if (this.entries.size <= this.max) break;
      if (e.refs === 0) {
        this.entries.delete(key);
        this.onEvict?.(key);
      }
    }
  }
}
