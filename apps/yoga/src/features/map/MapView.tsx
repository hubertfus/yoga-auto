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
import { store, useConfig, useFastValue } from "../../core/store.ts";
import { useStopPoints, type StopPoint } from "../route/bus.tsx";
import {
  DEFAULT_PROJECTION,
  gameToLonLat,
  lonLatToGame,
  haversineM,
  headingToBearing,
  type ProjectionConfig,
} from "./projection.ts";
import { normalizeBearing, springStep, unwrapAngle, type Spring1D } from "./spring.ts";
export { loadViewMode, type MapViewMode } from "./camera.ts";
import { cameraBearing, cameraStep, loadViewMode, saveViewMode, TILT_PITCH, TILT_SHIFT, type MapViewMode } from "./camera.ts";
import { attachImageLoader } from "./icons.ts";
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
  /** widok 3D: mapa pochylona, pojazd niżej na ekranie (więcej drogi przed nim) */
  toggleTilt(): void;
}

export interface MapViewProps {
  /** false = tło (nav): bez gestów, zawsze follow */
  interactive?: boolean;
  zoom?: number;
  /** wywoływane przy zmianie trybu follow (gest przeciągnięcia wyłącza follow) */
  onFollowChange?: (follow: boolean) => void;
  onHeadingUpChange?: (v: boolean) => void;
  onTiltChange?: (v: boolean) => void;
  /** przytrzymanie palca w miejscu (wybór celu): punkt w metrach gry + pozycja na ekranie względem mapy */
  onLongPress?: (p: { x: number; z: number; left: number; top: number }) => void;
  /** uchwyt do przycisków zewnętrznych */
  controlsRef?: { current: MapControls | null };
  /** klucz zapamiętania zoomu i trybu widoku (localStorage), np. `home`, `nav`; brak = zawsze `zoom`, 2D, północ w górę */
  zoomKey?: string;
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

/** GeoJSON przystanków kursu autobusowego (punkty z `state`: done/here/next/later). */
export function stopsGeoJson(stops: readonly StopPoint[], cfg: ProjectionConfig): GeoJSONSourceData {
  return {
    type: "FeatureCollection",
    features: stops.map((s) => {
      const { lon, lat } = gameToLonLat(s.x, s.z, cfg);
      return { type: "Feature", properties: { state: s.state, name: s.name }, geometry: { type: "Point", coordinates: [lon, lat] } };
    }),
  };
}

function addRouteLayers(map: MlMap, colors: MapColors): void {
  if (map.getSource("route")) return;
  // trasa pod symbolami (nazwy miast, ikony POI), nad drogami
  const before = map.getStyle().layers.find((l) => l.id.startsWith("sym-"))?.id;
  map.addSource("route", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  const w = (base: number) => ["interpolate", ["exponential", 1.5], ["zoom"], 5, base * 0.5, 10, base * 1.2, 14, base * 2.6, 18, base * 6];
  map.addLayer({
    id: "route-casing",
    type: "line",
    source: "route",
    filter: ["==", ["get", "kind"], "line"],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": colors.bg, "line-opacity": 0.85, "line-width": w(4.2) as never },
  }, before);
  map.addLayer({
    id: "route-line",
    type: "line",
    source: "route",
    filter: ["==", ["get", "kind"], "line"],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": colors.accent, "line-width": w(2.6) as never },
  }, before);
  // przystanki kursu autobusowego: miniony szary, następny/bieżący w kolorze akcentu, dalsze obwódką
  map.addSource("stops", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addLayer({
    id: "bus-stops",
    type: "circle",
    source: "stops",
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, ["match", ["get", "state"], "next", 6, 4], 12, ["match", ["get", "state"], "next", 11, 8]] as never,
      "circle-color": ["match", ["get", "state"], "done", colors.labelDim, "later", colors.bg, colors.accent] as never,
      "circle-stroke-color": ["match", ["get", "state"], "done", colors.bg, "later", colors.accent, "#fff"] as never,
      "circle-stroke-width": ["match", ["get", "state"], "next", 3, 2] as never,
    },
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
const LONG_PRESS_MS = 600;
const SNAP_M = 400; // skok większy niż to (teleport/zmiana sesji) = bez animacji
const END_DELAY_MS = 350;
const MIN_ZOOM = 3;
const MAX_ZOOM = 18;
const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

/** Zapamiętany zoom widoku (per klucz); błędy storage (tryb prywatny itp.) ignorujemy. */
export function loadZoom(key: string | undefined, fallback: number): number {
  if (!key) return fallback;
  try {
    const v = Number(localStorage.getItem(`yoga.map.zoom.${key}`));
    return Number.isFinite(v) && v >= MIN_ZOOM && v <= MAX_ZOOM ? v : fallback;
  } catch {
    return fallback;
  }
}
function saveZoom(key: string | undefined, z: number): void {
  if (!key) return;
  try {
    localStorage.setItem(`yoga.map.zoom.${key}`, z.toFixed(2));
  } catch {
    /* brak storage — zoom tylko do końca widoku */
  }
}

export function MapView({
  interactive = true,
  zoom = 13,
  onFollowChange,
  onHeadingUpChange,
  onTiltChange,
  controlsRef,
  className,
  onLongPress,
  zoomKey,
}: MapViewProps) {
  const host = useRef<HTMLDivElement>(null);
  const [probe, setProbe] = useState<TileProbe | null>(null);
  const [hasFix, setHasFix] = useState(false);
  const projRef = useRef<ProjectionConfig>(DEFAULT_PROJECTION);
  const target = useRef<{ lon: number; lat: number; bearing: number } | null>(null);
  const follow = useRef(true);
  const mode = useRef<MapViewMode>(loadViewMode(zoomKey));
  const cb = useRef({ onFollowChange, onHeadingUpChange, onTiltChange, onLongPress });
  cb.current = { onFollowChange, onHeadingUpChange, onTiltChange, onLongPress };
  const snapNext = useRef(true);
  // przystanki kursu autobusowego (pozycje z route-places.json); rysowane po załadowaniu stylu
  const stops = useStopPoints(useConfig((c) => c.job));
  const applyStops = useRef<(s: readonly StopPoint[]) => void>(() => {});
  const stopsNow = useRef(stops);
  stopsNow.current = stops;
  useEffect(() => applyStops.current(stops), [stops]);

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
    // przytrzymanie jednym palcem bez ruchu → onLongPress (wybór celu na mapie)
    let pressTimer: ReturnType<typeof setTimeout> | undefined;
    let pressAt: { x: number; y: number } | null = null;
    const cancelPress = () => {
      clearTimeout(pressTimer);
      pressAt = null;
    };
    const down = (e: PointerEvent) => {
      pointers.add(e.pointerId);
      cancelPress();
      if (!interactive || pointers.size !== 1 || e.button > 0) return;
      pressAt = { x: e.clientX, y: e.clientY };
      pressTimer = setTimeout(() => {
        const at = pressAt;
        pressAt = null;
        if (!at || !map || !cb.current.onLongPress) return;
        const rect = el.getBoundingClientRect();
        const left = at.x - rect.left;
        const top = at.y - rect.top;
        const ll = map.unproject([left, top]);
        const g = lonLatToGame(ll.lng, ll.lat, projRef.current);
        navigator.vibrate?.(15);
        cb.current.onLongPress({ x: g.x, z: g.z, left, top });
      }, LONG_PRESS_MS);
    };
    const movePress = (e: PointerEvent) => {
      if (pressAt && Math.hypot(e.clientX - pressAt.x, e.clientY - pressAt.y) > 10) cancelPress();
    };
    const up = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      cancelPress();
    };
    el.addEventListener("pointermove", movePress);
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
      // tryb startowy bez animacji (widok od razu tak, jak go zostawiono)
      let cam = { blend: mode.current.headingUp ? 1 : 0, pitch: mode.current.tilt ? TILT_PITCH : 0 };
      const shift = () => ({ top: el.clientHeight * TILT_SHIFT * (cam.pitch / TILT_PITCH), bottom: 0, left: 0, right: 0 });
      map = new maplibregl.Map({
        container: el,
        style: buildStyle(colors, probe.tiles),
        center: t0 ? [t0.lon, t0.lat] : [probe.tiles ? 10 : 15, 50],
        zoom: loadZoom(zoomKey, zoom),
        pitch: cam.pitch,
        bearing: t0 ? cameraBearing(t0.bearing, cam.blend) : 0,
        maxZoom: MAX_ZOOM,
        attributionControl: false,
        interactive,
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false, // pochylenie tylko przyciskiem 3D (gest walczyłby z animacją kamery)
        fadeDuration: 0,
      });
      map.touchZoomRotate.disableRotation();
      map.setPadding(shift());
      attachImageLoader(map, colors);
      (window as unknown as { __map?: MlMap }).__map = map;

      // trasa GPS (z bridge'a, wiadomość `route`)
      let shownRoute: RouteInfo | null | undefined;
      let styleReady = false;
      applyRoute = () => {
        if (!map || !styleReady || store.route === shownRoute) return;
        shownRoute = store.route;
        (map.getSource("route") as GeoJSONSource | undefined)?.setData(routeGeoJson(shownRoute, projRef.current));
      };
      applyStops.current = (s) => {
        if (!map || !styleReady) return;
        (map.getSource("stops") as GeoJSONSource | undefined)?.setData(stopsGeoJson(s, projRef.current));
      };
      map.on("load", () => {
        if (!map) return;
        addRouteLayers(map, colors);
        styleReady = true;
        applyRoute();
        applyStops.current(stopsNow.current);
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

      // zoom z przycisków animujemy w pętli rAF razem z kamerą (easeTo przerywałby jumpTo trybu follow)
      let zoomTarget: number | null = null;
      map.on("zoomend", () => {
        if (map && zoomTarget === null) saveZoom(zoomKey, map.getZoom());
      });
      if (controlsRef) {
        controlsRef.current = {
          zoomBy: (d) => {
            if (!map) return;
            zoomTarget = clampZoom((zoomTarget ?? map.getZoom()) + d);
          },
          recenter: () => {
            follow.current = true;
            snapNext.current = true;
            cb.current.onFollowChange?.(true);
          },
          toggleHeadingUp: () => {
            mode.current = { ...mode.current, headingUp: !mode.current.headingUp };
            saveViewMode(zoomKey, mode.current);
            cb.current.onHeadingUpChange?.(mode.current.headingUp);
          },
          toggleTilt: () => {
            mode.current = { ...mode.current, tilt: !mode.current.tilt };
            saveViewMode(zoomKey, mode.current);
            cb.current.onTiltChange?.(mode.current.tilt);
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
        let nextZoom: number | undefined;
        if (zoomTarget !== null && map && pointers.size === 0) {
          const z = map.getZoom();
          const dz = zoomTarget - z;
          nextZoom = Math.abs(dz) < 0.01 ? zoomTarget : z + dz * Math.min(1, dt * 12);
          if (nextZoom === zoomTarget) {
            zoomTarget = null;
            saveZoom(zoomKey, nextZoom);
          }
        }
        const tg = target.current;
        if (!map) return;
        const prevCam = cam;
        cam = cameraStep(cam, mode.current, dt);
        const camMoving = cam.blend !== prevCam.blend || cam.pitch !== prevCam.pitch;
        if (!tg || !marker) {
          if (nextZoom !== undefined || camMoving) map.jumpTo({ ...(nextZoom !== undefined ? { zoom: nextZoom } : {}), pitch: cam.pitch, padding: shift() });
          return;
        }
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
        const zoomPart = nextZoom !== undefined ? { zoom: nextZoom } : {};
        if (pointers.size > 0) return;
        if (follow.current || !interactive) {
          // za pojazdem: obrót wg kursu (płynne przejście blend), pochylenie i pojazd niżej w 3D
          map.jumpTo({ center: [lon.x, lat.x], ...zoomPart, bearing: cameraBearing(b, cam.blend), pitch: cam.pitch, padding: shift() });
        } else if (nextZoom !== undefined || camMoving) {
          // widok swobodny: nie przesuwamy środka; wyłączenie „kierunku w górę” wraca do północy
          const bearing = mode.current.headingUp ? map.getBearing() : cameraBearing(map.getBearing(), cam.blend);
          map.jumpTo({ ...zoomPart, bearing, pitch: cam.pitch });
        }
      };
      raf = requestAnimationFrame(tick);
    });

    return () => {
      disposed = true;
      applyStops.current = () => {};
      unsubRoute();
      cancelAnimationFrame(raf);
      clearTimeout(endTimer);
      cancelPress();
      el.removeEventListener("pointermove", movePress);
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
