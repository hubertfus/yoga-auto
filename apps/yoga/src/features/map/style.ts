/**
 * Ciemny styl MapLibre z tokenów (--bg-0, --text-2/3, --accent). Styl jest sterowany DANYMI: dla każdej warstwy
 * wektorowej z metadanych PMTiles dodajemy wypełnienie (Polygon) i linię (LineString) dobrane po nazwie,
 * więc nie zakładamy nazw warstw generatora (README projektu ich nie podaje).
 */
import type { StyleSpecification, LayerSpecification } from "maplibre-gl";
import { symbolLayers } from "./icons.ts";

export interface MapColors {
  /** tło mapy */
  bg: string;
  /** powierzchnie lądowe/obszary */
  land: string;
  water: string;
  road: string;
  roadMajor: string;
  rail: string;
  accent: string;
  /** nazwy miast */
  label: string;
  /** nazwy krajów */
  labelDim: string;
}

/** Zapasowe kolory (SSR/testy/brak DOM) — zbliżone do tokenów dark. */
export const FALLBACK_COLORS: MapColors = {
  bg: "rgb(14,16,22)",
  land: "rgb(24,27,36)",
  water: "rgb(20,32,52)",
  road: "rgb(78,84,100)",
  roadMajor: "rgb(150,156,172)",
  rail: "rgb(60,64,76)",
  accent: "rgb(86,140,255)",
  label: "rgb(236,238,244)",
  labelDim: "rgb(150,156,172)",
};

export interface TileSource {
  /** pełny adres .pmtiles (z tokenem) */
  url: string;
  /** id warstw wektorowych z metadanych */
  layers: string[];
}

const WATER = /water|sea|lake|river|ocean/i;
const ROAD_MAJOR = /motorway|highway|trunk|primary|major|freeway/i;
const RAIL = /rail|tram|subway/i;
const ROADISH = /road|street|way|path|route|prefab|nav/i;

type Kind = "water" | "road-major" | "rail" | "road" | "area";

export function classifyLayer(id: string): Kind {
  if (WATER.test(id)) return "water";
  if (RAIL.test(id)) return "rail";
  if (ROAD_MAJOR.test(id)) return "road-major";
  if (ROADISH.test(id)) return "road";
  return "area";
}

export function buildStyle(colors: MapColors, tiles: TileSource | null): StyleSpecification {
  const layers: LayerSpecification[] = [{ id: "bg", type: "background", paint: { "background-color": colors.bg } }];
  const sources: StyleSpecification["sources"] = {};
  if (tiles && tiles.layers.length) {
    sources.europe = { type: "vector", url: `pmtiles://${tiles.url}`, attribution: "Dane: truckermudgeon/maps (GPL-3.0)" };
    // najpierw powierzchnie, potem linie (kolejność metadanych w obrębie grupy)
    for (const id of tiles.layers) {
      const kind = classifyLayer(id);
      if (kind === "road" || kind === "road-major" || kind === "rail") continue;
      layers.push({
        id: `fill-${id}`,
        type: "fill",
        source: "europe",
        "source-layer": id,
        filter: ["==", ["geometry-type"], "Polygon"],
        paint: { "fill-color": kind === "water" ? colors.water : colors.land, "fill-opacity": kind === "water" ? 0.9 : 0.75 },
      });
    }
    for (const id of tiles.layers) {
      const kind = classifyLayer(id);
      const major = kind === "road-major";
      const rail = kind === "rail";
      layers.push({
        id: `line-${id}`,
        type: "line",
        source: "europe",
        "source-layer": id,
        filter: ["==", ["geometry-type"], "LineString"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": rail ? colors.rail : major ? colors.roadMajor : kind === "water" ? colors.water : colors.road,
          "line-width": ["interpolate", ["exponential", 1.6], ["zoom"], 4, major ? 0.6 : 0.2, 10, major ? 2 : 0.8, 15, major ? 8 : 4, 18, major ? 22 : 12],
          ...(rail ? { "line-dasharray": [3, 3] } : {}),
        },
      });
    }
  }
  // punkty (miasta, POI, numery dróg) na wierzchu; obrazki ładuje `attachImageLoader` (icons.ts)
  if (tiles) for (const id of tiles.layers) layers.push(...symbolLayers(id));
  return { version: 8, sources, layers };
}

/** Konwersja dowolnego koloru CSS (także oklch z tokenów) na `rgb(r,g,b)` przez canvas; MapLibre nie czyta oklch. */
export function cssToRgb(css: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  try {
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx) return fallback;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    return a ? `rgb(${r},${g},${b})` : fallback;
  } catch {
    return fallback;
  }
}

/** Kolory mapy z aktualnych tokenów (motyw/noc zmieniają zmienne CSS na <html>). */
export function readMapColors(): MapColors {
  if (typeof document === "undefined") return FALLBACK_COLORS;
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string) => cs.getPropertyValue(name).trim();
  const pick = (name: string, fb: string) => (v(name) ? cssToRgb(v(name), fb) : fb);
  const bg = pick("--bg-0", FALLBACK_COLORS.bg);
  const mix = (token: string, fb: string, pct: number) =>
    v(token) ? cssToRgb(`color-mix(in oklab, ${v(token)} ${pct}%, ${v("--bg-0") || "black"})`, fb) : fb;
  return {
    bg,
    land: mix("--glass-tint", FALLBACK_COLORS.land, 55),
    water: mix("--accent", FALLBACK_COLORS.water, 14),
    road: mix("--text-3", FALLBACK_COLORS.road, 85),
    roadMajor: mix("--text-2", FALLBACK_COLORS.roadMajor, 90),
    rail: mix("--text-3", FALLBACK_COLORS.rail, 45),
    accent: pick("--accent", FALLBACK_COLORS.accent),
    label: pick("--text-1", FALLBACK_COLORS.label),
    labelDim: pick("--text-3", FALLBACK_COLORS.labelDim),
  };
}
