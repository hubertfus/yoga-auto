/**
 * Filtry SVG refrakcji.
 *
 * Kontrakt z shellem (S4): w `index.html` ląduje statyczny host `<svg id="lg-filters">` (wynik `filtersMarkup()`),
 * dzięki czemu CSS nigdy nie odwołuje się do filtra, którego nie ma w DOM (wyścig hydratacji, ANALYSIS.md §4.3).
 * Filtry per rozmiar (`#lg-r-<w>x<h>r<r>`) dopisuje do `<defs>` biblioteka w czasie działania, a CSS dostaje
 * `url()` dopiero PO wstawieniu filtra do DOM. Jeśli hosta nie ma w index.html, `injectFilters()` utworzy go.
 */
import { DisplacementCache, type MapEntry } from "./cache.ts";

export const FILTER_HOST_ID = "lg-filters";
export const FILTER_DEFS_ID = "lg-filter-defs";
const SVG_NS = "http://www.w3.org/2000/svg";

/** Identyfikator filtra dla klucza `w×h×r`. */
export const refractFilterId = (key: string): string => `lg-r-${key}`;

/**
 * Snippet do wklejenia w `index.html` (jako pierwsze dziecko `<body>`). Zawiera też stały filtr `#lg-refract`
 * (neutralny; zgodność z placeholderem z Fazy 0).
 */
export function filtersMarkup(): string {
  return (
    `<svg id="${FILTER_HOST_ID}" width="0" height="0" style="position:absolute;width:0;height:0;pointer-events:none" aria-hidden="true" focusable="false">` +
    `<defs id="${FILTER_DEFS_ID}">` +
    `<filter id="lg-refract" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">` +
    `<feOffset in="SourceGraphic" dx="0" dy="0"/></filter>` +
    `</defs></svg>`
  );
}

/** Zapewnia obecność hosta filtrów w dokumencie; zwraca `<defs>`. */
export function injectFilters(doc: Document = document): SVGDefsElement {
  const existing = doc.getElementById(FILTER_DEFS_ID);
  if (existing) return existing as unknown as SVGDefsElement;
  const tpl = doc.createElement("template");
  tpl.innerHTML = filtersMarkup();
  const host = tpl.content.firstElementChild as Element;
  (doc.body ?? doc.documentElement).prepend(host);
  return doc.getElementById(FILTER_DEFS_ID) as unknown as SVGDefsElement;
}

export interface RefractHandle {
  id: string;
  /** wartość do `--lg-refract-url` */
  url: string;
  release(): void;
}

/**
 * Rejestr filtrów: cache map + węzły `<filter>` w `<defs>`. Węzły znikają razem z wpisem LRU.
 */
export class RefractFilterRegistry {
  readonly cache: DisplacementCache;
  private scale = 28;
  private defs: SVGDefsElement | null = null;

  constructor(cache: DisplacementCache = new DisplacementCache()) {
    this.cache = cache;
    this.cache.onEvict = (key) => this.defs?.querySelector(`#${CSS.escape(refractFilterId(key))}`)?.remove();
  }

  /** Skala `feDisplacementMap` zależna od tieru (`--refract-scale`); aktualizuje istniejące filtry. */
  setScale(scale: number): void {
    if (scale === this.scale) return;
    this.scale = scale;
    this.defs?.querySelectorAll("feDisplacementMap").forEach((n) => n.setAttribute("scale", String(scale)));
  }

  get currentScale(): number {
    return this.scale;
  }

  acquire(w: number, h: number, r: number, doc: Document = document): RefractHandle {
    if (!this.defs?.isConnected) this.defs = injectFilters(doc);
    const defs = this.defs;
    const entry = this.cache.acquire(w, h, r);
    const id = refractFilterId(entry.key);
    if (!defs.querySelector(`#${CSS.escape(id)}`)) defs.appendChild(this.build(doc, id, entry));
    let released = false;
    return {
      id,
      url: `url(#${id})`,
      release: () => {
        if (released) return;
        released = true;
        this.cache.release(entry.key);
      },
    };
  }

  private build(doc: Document, id: string, e: MapEntry): SVGFilterElement {
    const f = doc.createElementNS(SVG_NS, "filter") as SVGFilterElement;
    f.setAttribute("id", id);
    f.setAttribute("filterUnits", "userSpaceOnUse");
    f.setAttribute("primitiveUnits", "userSpaceOnUse");
    f.setAttribute("x", "0");
    f.setAttribute("y", "0");
    f.setAttribute("width", String(e.w));
    f.setAttribute("height", String(e.h));
    f.setAttribute("color-interpolation-filters", "sRGB");
    const img = doc.createElementNS(SVG_NS, "feImage");
    img.setAttribute("href", e.dataUrl);
    img.setAttribute("x", "0");
    img.setAttribute("y", "0");
    img.setAttribute("width", String(e.w));
    img.setAttribute("height", String(e.h));
    img.setAttribute("preserveAspectRatio", "none");
    img.setAttribute("result", "lg-map");
    const disp = doc.createElementNS(SVG_NS, "feDisplacementMap");
    disp.setAttribute("in", "SourceGraphic");
    disp.setAttribute("in2", "lg-map");
    disp.setAttribute("scale", String(this.scale));
    disp.setAttribute("xChannelSelector", "R");
    disp.setAttribute("yChannelSelector", "G");
    f.append(img, disp);
    return f;
  }
}

/** Domyślny rejestr (singleton biblioteki). */
export const refractFilters = new RefractFilterRegistry();
