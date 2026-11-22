/**
 * MapView: MapLibre GL + kafle PMTiles + marker ciężarówki (sprężyna) + tryb follow/swobodny.
 * Pozycja pochodzi z `fast.placement` (subskrypcja `placement: true`, ≤ 10 Hz). Marker i kamera są
 * aktualizowane w rAF poza Reactem (bez re-renderów). Podczas panningu/zoomu tier spada lokalnie do `lite`.
 */
import { useEffect, useRef, useState } from "react";
import type { GeoJSONSource, GeoJSONSourceSpecification, Map as MlMap, Marker } from "maplibre-gl";

type GeoJSONSourceData = Exclude<GeoJSONSourceSpecification["data"], string>;
import type { RouteInfo } from "@yoga-auto/protocol";
import { springs } from "@yoga-auto/design-tokens";
import { perfStore } from "@yoga-auto/glass-ui";
import { client } from "../../core/client.ts";
import { store, useFastValue } from "../../core/store.ts";
import {
  DEFAULT_PROJECTION,
  gameToLonLat,
  haversineM,
  headingToBearing,
  type ProjectionConfig,
} from "./projection.ts";
import { normalizeBearing, springStep, unwrapAngle, type Spring1D } from "./spring.ts";
import { buildStyle, readMapColors, type MapColors } from "./style.ts";
import { createTierDrop } from "./tierDrop.ts";
import { pmtilesProtocol, probeTiles, type TileProbe } from "./tiles.ts";

/** Jeden spadek tieru na stronę (kilka widoków mapy nie blokuje się nawzajem). */
export const localTier = createTierDrop({
  current: () => perfStore.tier,
  apply: (t) => void (document.documentElement.dataset.tier = t),
  restore: () => perfStore.applyCurrent(),
});

/** Subskrypcja `placement` z licznikiem widoków. */
let placementUsers = 0;
export function usePlacementSubscription(): void {
  useEffect(() => {
    if (placementUsers++ === 0) client.subscribe({ placement: true });
    return () => {
      if (--placementUsers === 0) client.subscribe({ placement: false });
    };
  }, []);
}

export interface MapControls {
  zoomBy(delta: number): void;
  recenter(): void;
  toggleHeadingUp(): void;
}

export interface MapViewProps {
  /** false = tło (nav): bez gestów, zawsze follow */
  interactive?: boolean;
  zoom?: number;
  /** wywoływane przy zmianie trybu follow (gest przeciągnięcia wyłącza follow) */
  onFollowChange?: (follow: boolean) => void;
  onHeadingUpChange?: (v: boolean) => void;
  /** uchwyt do przycisków zewnętrznych */
  controlsRef?: { current: MapControls | null };
  className?: string;
}

/** GeoJSON trasy (linia + punkt celu) w lon/lat. */
export function routeGeoJson(route: RouteInfo | null, cfg: ProjectionConfig): GeoJSONSourceData {
  if (!route || route.points.length < 4) return { type: "FeatureCollection", features: [] };
  const coords: [number, number][] = [];
  for (let i = 0; i + 1 < route.points.length; i += 2) {
    const { lon, lat } = gameToLonLat(route.points[i]!, route.points[i + 1]!, cfg);
    coords.push([lon, lat]);
  }
  return {
    type: "FeatureCollection",
    features: [
      { type: "Feature", properties: { kind: "line" }, geometry: { type: "LineString", coordinates: coords } },
      { type: "Feature", properties: { kind: "dest" }, geometry: { type: "Point", coordinates: coords.at(-1)! } },
    ],
  };
}

function addRouteLayers(map: MlMap, colors: MapColors): void {
  if (map.getSource("route")) return;
  map.addSource("route", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  const w = (base: number) => ["interpolate", ["exponential", 1.5], ["zoom"], 5, base * 0.5, 10, base * 1.2, 14, base * 2.6, 18, base * 6];
  map.addLayer({
    id: "route-casing",
    type: "line",
    source: "route",
    filter: ["==", ["get", "kind"], "line"],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": colors.bg, "line-opacity": 0.85, "line-width": w(4.2) as never },
  });
  map.addLayer({
    id: "route-line",
    type: "line",
    source: "route",
    filter: ["==", ["get", "kind"], "line"],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": colors.accent, "line-width": w(2.6) as never },
  });
  map.addLayer({
    id: "route-dest",
    type: "circle",
    source: "route",
    filter: ["==", ["get", "kind"], "dest"],
    paint: {
      "circle-radius": 9,
      "circle-color": colors.accent,
      "circle-stroke-color": "#fff",
      "circle-stroke-width": 3,
    },
  });
}

const SPRING = springs.smooth;
const SNAP_M = 400; // skok większy niż to (teleport/zmiana sesji) = bez animacji
const END_DELAY_MS = 350;

export function MapView({
  interactive = true,
  zoom = 13,
  onFollowChange,
  onHeadingUpChange,
  controlsRef,
  className,
}: MapViewProps) {
  const host = useRef<HTMLDivElement>(null);
  const [probe, setProbe] = useState<TileProbe | null>(null);
  const [hasFix, setHasFix] = useState(false);
  const projRef = useRef<ProjectionConfig>(DEFAULT_PROJECTION);
  const target = useRef<{ lon: number; lat: number; bearing: number } | null>(null);
  const follow = useRef(true);
  const headingUp = useRef(false);
  const cb = useRef({ onFollowChange, onHeadingUpChange });
  cb.current = { onFollowChange, onHeadingUpChange };
  const snapNext = useRef(true);

  usePlacementSubscription();

  useFastValue(
    (f) => f.placement,
    (p) => {
      if (!p) return;
      const cfg = projRef.current;
      const { lon, lat } = gameToLonLat(p.x, p.z, cfg);
      const bearing = headingToBearing(p.x, p.z, p.heading, cfg);
      const prev = target.current;
      if (prev && haversineM(prev, { lon, lat }) > SNAP_M) snapNext.current = true;
      target.current = { lon, lat, bearing };
      setHasFix(true);
    },
  );

  // wykrycie kafli (raz na montaż)
  useEffect(() => {
    let alive = true;
    void probeTiles().then((r) => {
      if (!alive) return;
      if (r.projection) projRef.current = r.projection;
      setProbe(r);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const el = host.current;
    if (!el || !probe) return;
    let disposed = false;
    let map: MlMap | null = null;
    let marker: Marker | null = null;
    let raf = 0;
    let endTimer: ReturnType<typeof setTimeout> | undefined;
    let dropped = false;
    let applyRoute = () => {};
    let unsubRoute = () => {};
    // dopóki palec/mysz jest na mapie, nie ruszamy kamery (jumpTo przerywa gest przeciągania/pinch)
    const pointers = new Set<number>();
    const down = (e: PointerEvent) => void pointers.add(e.pointerId);
    const up = (e: PointerEvent) => void pointers.delete(e.pointerId);
    el.addEventListener("pointerdown", down);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    const begin = () => {
      clearTimeout(endTimer);
      if (!dropped) {
        dropped = true;
        localTier.begin();
      }
    };
    const end = () => {
      clearTimeout(endTimer);
      endTimer = setTimeout(() => {
        if (dropped) {
          dropped = false;
          localTier.end();
        }
      }, END_DELAY_MS);
    };

    void import("maplibre-gl").then((ml) => {
      if (disposed || !host.current) return;
      const maplibregl = ml.default ?? ml;
      maplibregl.addProtocol("pmtiles", pmtilesProtocol().tile);
      const t0 = target.current;
      const colors = readMapColors();
      map = new maplibregl.Map({
        container: el,
        style: buildStyle(colors, probe.tiles),
        center: t0 ? [t0.lon, t0.lat] : [probe.tiles ? 10 : 15, 50],
        zoom,
        maxZoom: 18,
        attributionControl: false,
        interactive,
        dragRotate: false,
        pitchWithRotate: false,
        fadeDuration: 0,
      });
      map.touchZoomRotate.disableRotation();
      (window as unknown as { __map?: MlMap }).__map = map;

      // trasa GPS (z bridge'a, wiadomość `route`)
      let shownRoute: RouteInfo | null | undefined;
      let styleReady = false;
      applyRoute = () => {
        if (!map || !styleReady || store.route === shownRoute) return;
        shownRoute = store.route;
        (map.getSource("route") as GeoJSONSource | undefined)?.setData(routeGeoJson(shownRoute, projRef.current));
      };
      map.on("load", () => {
        if (!map) return;
        addRouteLayers(map, colors);
        styleReady = true;
        applyRoute();
      });
      unsubRoute = store.subscribe(() => applyRoute());

      const dot = document.createElement("div");
      dot.className = "map-truck";
      dot.dataset.testid = "map-truck";
      dot.innerHTML =
        '<svg viewBox="-20 -24 40 48" aria-hidden="true"><path d="M0 -20 L13 16 L0 9 L-13 16 Z" /></svg>';
      marker = new maplibregl.Marker({ element: dot, rotationAlignment: "map", pitchAlignment: "map" })
        .setLngLat(t0 ? [t0.lon, t0.lat] : [15, 50])
        .addTo(map);

      if (interactive) {
        map.on("dragstart", () => {
          if (follow.current) {
            follow.current = false;
            cb.current.onFollowChange?.(false);
          }
        });
        for (const ev of ["movestart", "zoomstart", "dragstart"] as const) {
          map.on(ev, (e) => {
            if ((e as { originalEvent?: unknown }).originalEvent) begin();
          });
        }
        for (const ev of ["moveend", "zoomend", "dragend"] as const) map.on(ev, end);
      }

      if (controlsRef) {
        controlsRef.current = {
          zoomBy: (d) => map?.easeTo({ zoom: Math.min(18, Math.max(3, map.getZoom() + d)), duration: 200 }),
          recenter: () => {
            follow.current = true;
            snapNext.current = true;
            cb.current.onFollowChange?.(true);
          },
          toggleHeadingUp: () => {
            headingUp.current = !headingUp.current;
            if (!headingUp.current) map?.setBearing(0);
            cb.current.onHeadingUpChange?.(headingUp.current);
          },
        };
      }

      let lon: Spring1D = { x: t0?.lon ?? 15, v: 0 };
      let lat: Spring1D = { x: t0?.lat ?? 50, v: 0 };
      let brg: Spring1D = { x: t0?.bearing ?? 0, v: 0 };
      let last = performance.now();
      const tick = (now: number) => {
        raf = requestAnimationFrame(tick);
        const dt = Math.min(0.1, (now - last) / 1000);
        last = now;
        const tg = target.current;
        if (!tg || !map || !marker) return;
        if (snapNext.current) {
          lon = { x: tg.lon, v: 0 };
          lat = { x: tg.lat, v: 0 };
          brg = { x: tg.bearing, v: 0 };
          snapNext.current = false;
        } else {
          lon = springStep(lon, tg.lon, dt, SPRING);
          lat = springStep(lat, tg.lat, dt, SPRING);
          brg = springStep(brg, unwrapAngle(brg.x, tg.bearing), dt, SPRING);
        }
        const b = normalizeBearing(brg.x);
        marker.setLngLat([lon.x, lat.x]);
        marker.setRotation(b);
        if ((follow.current || !interactive) && pointers.size === 0) {
          map.jumpTo({ center: [lon.x, lat.x], ...(headingUp.current ? { bearing: b } : {}) });
        }
      };
      raf = requestAnimationFrame(tick);
    });

    return () => {
      disposed = true;
      unsubRoute();
      cancelAnimationFrame(raf);
      clearTimeout(endTimer);
      el.removeEventListener("pointerdown", down);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (dropped) localTier.end();
      if (controlsRef) controlsRef.current = null;
      const w = window as unknown as { __map?: MlMap };
      if (w.__map === map) delete w.__map; // inny widok mapy (np. Home → ekran Mapa) mógł już podmienić uchwyt
      marker?.remove();
      map?.remove();
    };
    // mapę budujemy raz po wykryciu kafli; zmiany propsów nie przebudowują mapy
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [probe]);

  return (
    <div className={`map-view${className ? ` ${className}` : ""}`} data-testid="map-view" data-interactive={interactive}>
      <div ref={host} className="map-canvas" />
      {probe && !probe.tiles ? (
        <div className="map-empty" data-testid="map-no-tiles" role="status">
          Brak kafli, uruchom <code>map:build</code>
        </div>
      ) : null}
      {probe && !hasFix ? (
        <div className="map-nofix" data-testid="map-no-fix" role="status">
          Czekam na pozycję…
        </div>
      ) : null}
    </div>
  );
}
