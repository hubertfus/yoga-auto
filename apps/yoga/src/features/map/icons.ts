/**
 * Ikony i etykiety na mapie bez zewnętrznych zasobów:
 * - ikony POI (stacje, parkingi, serwisy, logo firm, numery dróg) ładowane leniwie z `/tiles/icons/<sprite>.png`
 *   (kopiowane przez `map:graph` z danych parsera) przy zdarzeniu `styleimagemissing`,
 * - nazwy miast/krajów rysowane na canvasie jako obrazki (`city:<nazwa>`, `country:<nazwa>`): MapLibre bez
 *   serwera glifów nie wyrenderuje `text-field`, a aplikacja ma działać offline w sieci lokalnej.
 */
import type { LayerSpecification, Map as MlMap } from "maplibre-gl";
import { getToken } from "../../core/client.ts";
import type { MapColors } from "./style.ts";
import { withToken } from "./tiles.ts";

export const CITY_PREFIX = "city:";
export const CAPITAL_PREFIX = "capital:";
export const COUNTRY_PREFIX = "country:";

const PIXEL_RATIO = 2;

/** Obrazek etykiety: tekst z obwódką (halo) w kolorze tła mapy. */
export function labelImage(
  text: string,
  opts: { size: number; weight: number; fill: string; halo: string; upper?: boolean },
): { width: number; height: number; data: Uint8Array } | null {
  if (typeof document === "undefined") return null;
  const t = opts.upper ? text.toUpperCase() : text;
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  const px = opts.size * PIXEL_RATIO;
  const font = `${opts.weight} ${px}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  ctx.font = font;
  const halo = 4 * PIXEL_RATIO;
  const w = Math.ceil(ctx.measureText(t).width + halo * 2);
  const h = Math.ceil(px * 1.3 + halo * 2);
  c.width = w;
  c.height = h;
  ctx.font = font; // zmiana rozmiaru canvasa kasuje stan
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = halo;
  ctx.strokeStyle = opts.halo;
  ctx.strokeText(t, halo, h / 2);
  ctx.fillStyle = opts.fill;
  ctx.fillText(t, halo, h / 2);
  const img = ctx.getImageData(0, 0, w, h);
  return { width: w, height: h, data: new Uint8Array(img.data.buffer) };
}

const iconUrl = (id: string): string =>
  new URL(withToken(`/tiles/icons/${encodeURIComponent(id)}.png`, getToken()), location.href).href;

/** Podpina generowanie brakujących obrazków stylu (ikony POI + etykiety). */
export function attachImageLoader(map: MlMap, colors: MapColors): void {
  const requested = new Set<string>();
  const empty = { width: 1, height: 1, data: new Uint8Array(4) };
  map.on("styleimagemissing", (e: { id: string }) => {
    const id = e.id;
    if (!id || requested.has(id)) return;
    requested.add(id);
    const label = (text: string, size: number, weight: number, fill: string, upper = false) => {
      const img = labelImage(text, { size, weight, fill, halo: colors.bg, upper });
      if (img && !map.hasImage(id)) map.addImage(id, img, { pixelRatio: PIXEL_RATIO });
    };
    if (id.startsWith(CITY_PREFIX)) return label(id.slice(CITY_PREFIX.length), 14, 600, colors.label);
    if (id.startsWith(CAPITAL_PREFIX)) return label(id.slice(CAPITAL_PREFIX.length), 17, 700, colors.label);
    if (id.startsWith(COUNTRY_PREFIX)) return label(id.slice(COUNTRY_PREFIX.length), 13, 600, colors.labelDim, true);
    map
      .loadImage(iconUrl(id))
      .then((r) => {
        // ikony 32–128 px (różne typy); rozmiar na ekranie ustala `icon-size` warstwy
        if (!map.hasImage(id)) map.addImage(id, r.data);
      })
      .catch(() => {
        // brak ikony (stary eksport / nieznany sprite): pusty obrazek, żeby nie pytać ponownie
        if (!map.hasImage(id)) map.addImage(id, empty);
      });
  });
}

const isPoi = (poiType: string | string[]) =>
  [
    "all",
    ["==", ["geometry-type"], "Point"],
    ["==", ["get", "type"], "poi"],
    Array.isArray(poiType) ? ["in", ["get", "poiType"], ["literal", poiType]] : ["==", ["get", "poiType"], poiType],
  ] as const;

/**
 * Warstwy symboli dla punktów z kafli truckermudgeon (warstwa `ets2`): miasta, kraje, numery dróg, POI.
 * Zoom w MapLibre jest w skali świata rzeczywistego (mapa gry ×19), stąd progi ~9–13.
 */
export function symbolLayers(sourceLayer: string): LayerSpecification[] {
  const base = { type: "symbol" as const, source: "europe", "source-layer": sourceLayer };
  const icon = (size: number, extra: Record<string, unknown> = {}) => ({
    "icon-image": ["get", "sprite"],
    "icon-size": ["interpolate", ["linear"], ["zoom"], 8, size * 0.7, 13, size, 16, size * 1.3],
    "icon-padding": 4,
    ...extra,
  });
  return [
    {
      ...base,
      id: `sym-country-${sourceLayer}`,
      maxzoom: 8,
      filter: ["all", ["==", ["geometry-type"], "Point"], ["==", ["get", "type"], "country"]],
      layout: { "icon-image": ["concat", COUNTRY_PREFIX, ["get", "name"]], "icon-allow-overlap": false },
    },
    {
      ...base,
      id: `sym-road-${sourceLayer}`,
      minzoom: 8,
      filter: isPoi("road") as never,
      layout: icon(0.5, { "symbol-sort-key": 5, "icon-padding": 12 }) as never, // tablice 64 px
    },
    {
      ...base,
      id: `sym-traffic-${sourceLayer}`,
      minzoom: 12,
      filter: ["all", ["==", ["geometry-type"], "Point"], ["==", ["get", "type"], "traffic"]],
      layout: icon(0.9) as never, // 32 px
    },
    {
      ...base,
      id: `sym-poi-${sourceLayer}`,
      minzoom: 10,
      filter: isPoi(["facility", "landmark", "viewpoint", "ferry", "train"]) as never,
      layout: icon(1, { "symbol-sort-key": 3 }) as never, // ikony udogodnień 32 px
    },
    {
      ...base,
      id: `sym-company-${sourceLayer}`,
      minzoom: 11,
      filter: isPoi("company") as never,
      layout: icon(0.85, { "symbol-sort-key": 4 }) as never, // logo firm 128×32 px
    },
    {
      ...base,
      id: `sym-city-${sourceLayer}`,
      filter: ["all", ["==", ["geometry-type"], "Point"], ["==", ["get", "type"], "city"]],
      layout: {
        "icon-image": [
          "case",
          [">", ["coalesce", ["get", "capital"], 0], 0],
          ["concat", CAPITAL_PREFIX, ["get", "name"]],
          ["concat", CITY_PREFIX, ["get", "name"]],
        ],
        "symbol-sort-key": ["coalesce", ["get", "scaleRank"], 10],
        "icon-allow-overlap": false,
        "icon-padding": 6,
      } as never,
    },
  ];
}
