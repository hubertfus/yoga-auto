/**
 * Ciemny styl MapLibre z tokenów (--bg-0, --text-2/3, --accent). Styl jest sterowany DANYMI: dla każdej warstwy
 * wektorowej z metadanych PMTiles dodajemy wypełnienie (Polygon) i linię (LineString) dobrane po nazwie,
 * więc nie zakładamy nazw warstw generatora (README projektu ich nie podaje).
 */
import type { ExpressionSpecification, LayerSpecification, StyleSpecification } from "maplibre-gl";
import { symbolLayers } from "./icons.ts";
import { LANES_SOURCE, laneLayers } from "./lanes.ts";

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
  /** nawierzchnia jezdni i skrzyżowań */
  roadSurface: string;
  /** obrzeże jezdni */
  roadEdge: string;
  /** linie między pasami */
  marking: string;
  /** oś jezdni dwukierunkowej */
  markingCenter: string;
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
  roadSurface: "rgb(58,62,74)",
  roadEdge: "rgb(34,37,46)",
  marking: "rgb(190,194,204)",
  markingCenter: "rgb(222,224,230)",
};

export interface TileSource {
  /** pełny adres .pmtiles (z tokenem) */
  url: string;
  /** id warstw wektorowych z metadanych */
  layers: string[];
  /** adres `roads.pmtiles` (jezdnie z pasami, map:lanes); brak = tylko linie z kafli bazowych */
  lanes?: string;
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

/**
 * Szerokość drogi z kafli bazowych wg `roadType`: na małym zoomie czytelne minimum, od zoomu 10 rośnie ×2
 * na poziom jak prawdziwa jezdnia (≈ 9 m lokalna; drogi dwujezdniowe i autostrady to osobne linie dla każdej jezdni,
 * ≈ 11–13 m; 1 m gry ≈ 0,4 px przy z10).
 */
function roadWidth(): ExpressionSpecification {
  const by = (local: number, divided: number, freeway: number): ExpressionSpecification =>
    ["match", ["get", "roadType"], "freeway", freeway, "divided", divided, local] as ExpressionSpecification;
  return [
    "interpolate",
    ["exponential", 2],
    ["zoom"],
    5,
    by(0.35, 0.5, 0.6),
    9,
    by(1, 1.4, 1.6),
    10,
    by(3.6, 4.4, 5.2),
    22,
    by(3.6 * 4096, 4.4 * 4096, 5.2 * 4096),
  ] as ExpressionSpecification;
}

export function buildStyle(colors: MapColors, tiles: TileSource | null): StyleSpecification {
  const layers: LayerSpecification[] = [{ id: "bg", type: "background", paint: { "background-color": colors.bg } }];
  const sources: StyleSpecification["sources"] = {};
  if (tiles && tiles.layers.length) {
    sources.europe = { type: "vector", url: `pmtiles://${tiles.url}`, attribution: "Dane: truckermudgeon/maps (GPL-3.0)" };
    if (tiles.lanes) sources[LANES_SOURCE] = { type: "vector", url: `pmtiles://${tiles.lanes}` };
    const isRoad: ExpressionSpecification = ["==", ["get", "type"], "road"];
    const isPrefab: ExpressionSpecification = ["==", ["get", "type"], "prefab"];
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
        paint: {
          // skrzyżowania (prefaby) w kolorze nawierzchni, żeby łączyły się z jezdniami
          "fill-color": kind === "water" ? colors.water : ["case", isPrefab, colors.roadSurface, colors.land],
          "fill-opacity": kind === "water" ? 0.9 : ["case", isPrefab, 1, 0.75],
        },
      });
    }
    for (const id of tiles.layers) {
      const kind = classifyLayer(id);
      const major = kind === "road-major";
      const rail = kind === "rail";
      const generic = kind === "area"; // np. jedna warstwa `ets2` z typem obiektu we właściwościach
      const color = rail
        ? colors.rail
        : major
          ? colors.roadMajor
          : kind === "water"
            ? colors.water
            : generic
              ? (["case", isRoad, colors.roadSurface, colors.road] as ExpressionSpecification)
              : colors.road;
      layers.push({
        id: `line-${id}`,
        type: "line",
        source: "europe",
        "source-layer": id,
        filter: ["==", ["geometry-type"], "LineString"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": color,
          "line-width": generic
            ? roadWidth()
            : ["interpolate", ["exponential", 1.6], ["zoom"], 4, major ? 0.6 : 0.2, 10, major ? 2 : 0.8, 15, major ? 8 : 4, 18, major ? 22 : 12],
          // z jezdniami z pasami (roads.pmtiles) linie zostają pod spodem jako podkład: przejazdy przez prefaby
          // (węzły, mosty, segmenty dróg z gotowych elementów gry) są tylko w kaflach bazowych
          ...(rail ? { "line-dasharray": [3, 3] } : {}),
        },
      });
    }
    if (tiles.lanes) layers.push(...laneLayers(colors));
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
    roadSurface: mix("--text-3", FALLBACK_COLORS.roadSurface, 42),
    roadEdge: mix("--text-3", FALLBACK_COLORS.roadEdge, 16),
    marking: mix("--text-1", FALLBACK_COLORS.marking, 72),
    markingCenter: mix("--text-1", FALLBACK_COLORS.markingCenter, 88),
  };
}
