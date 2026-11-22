/**
 * Jezdnie w prawdziwej skali z pasami ruchu (kafle `roads.pmtiles`, warstwa `lanes`, generator: tools/map map:lanes).
 *
 * Każdy obiekt to linia środka odcinka drogi z właściwościami: l/r — pasy po lewej/prawej względem kierunku
 * linii, w — szerokość pasa (m świata gry), o — pas rozdzielający (m), k — px na 1 m świata przy zoomie 10.
 * Szerokości i przesunięcia (`line-offset`) liczymy w metrach gry i przeliczamy na px rosnąco ×2 na poziom
 * zoomu, więc jezdnia ma na mapie swoją prawdziwą szerokość i widać, którym pasem (i po której stronie) jedzie ciężarówka.
 */
import type { ExpressionSpecification, LayerSpecification } from "maplibre-gl";
import type { MapColors } from "./style.ts";

export const LANES_SOURCE = "lanes";
export const LANES_LAYER = "lanes";
/** od tego zoomu rysujemy jezdnie z pasami (niżej zostają linie z kafli bazowych) */
export const LANES_MINZOOM = 11.5;

type Expr = ExpressionSpecification;
const get = (p: string): Expr => ["get", p];
const num = (p: string, d = 0): Expr => ["coalesce", get(p), d] as Expr;

/** metry świata gry → px dla bieżącego zoomu (×2 na poziom) */
export function metersToPx(meters: Expr | number): Expr {
  return ["interpolate", ["exponential", 2], ["zoom"], 10, ["*", get("k"), meters], 22, ["*", get("k"), meters, 4096]] as Expr;
}

const W = num("w", 4.5);
const O = num("o");
const L = num("l");
const R = num("r");
/** połowa pasa rozdzielającego */
const halfO: Expr = ["/", O, 2];

/** środek jezdni prawej / lewej (m od linii środka) */
const rightCenter: Expr = ["+", halfO, ["/", ["*", R, W], 2]];
const leftCenter: Expr = ["-", 0, ["+", halfO, ["/", ["*", L, W], 2]]];

const markingWidth: Expr = ["interpolate", ["exponential", 2], ["zoom"], 12, 0.6, 15, 2, 18, 5];

export function laneLayers(colors: MapColors): LayerSpecification[] {
  const base = { source: LANES_SOURCE, "source-layer": LANES_LAYER, minzoom: LANES_MINZOOM };
  const fadeIn: Expr = ["interpolate", ["linear"], ["zoom"], LANES_MINZOOM, 0, LANES_MINZOOM + 0.5, 1];
  const layout = { "line-cap": "butt" as const, "line-join": "round" as const };
  const out: LayerSpecification[] = [];
  // obrzeże (pobocze) i nawierzchnia, osobno dla obu jezdni
  for (const [side, width, offset, filter] of [
    ["r", ["*", R, W], rightCenter, [">", R, 0]],
    ["l", ["*", L, W], leftCenter, [">", L, 0]],
  ] as [string, Expr, Expr, Expr][]) {
    out.push({
      ...base,
      id: `lane-edge-${side}`,
      type: "line",
      filter,
      layout,
      paint: {
        "line-color": colors.roadEdge,
        "line-opacity": fadeIn,
        "line-width": metersToPx(["+", width, 1.4]),
        "line-offset": metersToPx(offset),
      },
    });
  }
  for (const [side, width, offset, filter] of [
    ["r", ["*", R, W], rightCenter, [">", R, 0]],
    ["l", ["*", L, W], leftCenter, [">", L, 0]],
  ] as [string, Expr, Expr, Expr][]) {
    out.push({
      ...base,
      id: `lane-surface-${side}`,
      type: "line",
      filter,
      layout,
      paint: {
        "line-color": colors.roadSurface,
        "line-opacity": fadeIn,
        "line-width": metersToPx(width),
        "line-offset": metersToPx(offset),
      },
    });
  }
  // oś drogi dwukierunkowej bez pasa rozdzielającego: linia ciągła między kierunkami
  out.push({
    ...base,
    id: "lane-center",
    type: "line",
    filter: ["all", [">", L, 0], [">", R, 0], ["<", O, 0.6]],
    layout,
    paint: { "line-color": colors.markingCenter, "line-opacity": fadeIn, "line-width": markingWidth },
  });
  // linie między pasami tego samego kierunku (przerywane): do 4 pasów w jedną stronę
  for (const i of [1, 2, 3]) {
    for (const [side, count, sign] of [
      ["r", R, 1],
      ["l", L, -1],
    ] as [string, Expr, number][]) {
      out.push({
        ...base,
        id: `lane-sep-${side}${i}`,
        type: "line",
        filter: [">", count, i],
        layout,
        paint: {
          "line-color": colors.marking,
          "line-opacity": fadeIn,
          "line-width": markingWidth,
          "line-dasharray": [3, 4],
          "line-offset": metersToPx(["*", sign, ["+", halfO, ["*", i, W]]]),
        },
      });
    }
  }
  return out;
}
