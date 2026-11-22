/**
 * Postęp na trasie GPS (z `store.route` + `fast.placement`) i lista najbliższych manewrów.
 * Dystanse „jak w grze” (skala 19 poza miastem / 3 w mieście, `gameCumulative`), tak jak GPS w ETS2.
 */
import { useEffect, useRef, useState } from "react";
import {
  cumulative,
  gameCumulative,
  nextManeuverIndex,
  projectOnRoute,
  remap,
  type Maneuver,
  type ManeuverKind,
  type RouteInfo,
} from "@yoga-auto/protocol";
import { store, useFastValue, useRoute } from "../../core/store.ts";

export interface RouteModel {
  route: RouteInfo;
  /** skumulowany dystans świata per punkt */
  cum: Float64Array;
  /** skumulowany dystans gry per punkt */
  gcum: Float64Array;
  /** `at` manewrów w dystansie gry */
  gAt: number[];
}

const models = new WeakMap<RouteInfo, RouteModel>();

export function routeModel(route: RouteInfo): RouteModel {
  let m = models.get(route);
  if (!m) {
    const cum = cumulative(route.points);
    const gcum = gameCumulative(route.points, route.city ?? []);
    m = { route, cum, gcum, gAt: route.maneuvers.map((x) => remap(cum, gcum, x.at)) };
    models.set(route, m);
  }
  return m;
}

export interface UpcomingManeuver {
  maneuver: Maneuver;
  /** dystans gry od ciężarówki do manewru */
  distance: number;
  /** dystans gry od poprzedniego manewru (dla pierwszego = `distance`) */
  leg: number;
}

export interface RouteProgress {
  model: RouteModel;
  /** m świata od początku */
  along: number;
  /** m od trasy */
  offset: number;
  /** pozostały dystans gry do celu */
  remaining: number;
  upcoming: UpcomingManeuver[];
}

/** m — dalej niż to od trasy: pokazujemy „poza trasą” (bridge zaraz przeliczy) */
export const OFF_ROUTE_UI_M = 60;

export function progressOf(model: RouteModel, x: number, z: number, hint?: number, count = 6): (RouteProgress & { index: number }) | null {
  const { route, cum, gcum, gAt } = model;
  let pr = projectOnRoute(route.points, cum, x, z, hint);
  if (pr && pr.offset > OFF_ROUTE_UI_M && hint !== undefined) pr = projectOnRoute(route.points, cum, x, z) ?? pr;
  if (!pr) return null;
  const gAlong = remap(cum, gcum, pr.along);
  const first = nextManeuverIndex(route.maneuvers, pr.along);
  const upcoming: UpcomingManeuver[] = [];
  if (first >= 0) {
    for (let i = first; i < route.maneuvers.length && upcoming.length < count; i++) {
      const distance = Math.max(0, gAt[i]! - gAlong);
      const leg = i === first ? distance : gAt[i]! - gAt[i - 1]!;
      upcoming.push({ maneuver: route.maneuvers[i]!, distance, leg });
    }
  }
  return {
    model,
    along: pr.along,
    offset: pr.offset,
    remaining: Math.max(0, gcum[gcum.length - 1]! - gAlong),
    upcoming,
    index: pr.index,
  };
}

/** Hook: postęp na trasie, odświeżany przy zmianie pozycji (maks. ~4 Hz, żeby nie re-renderować 10×/s). */
export function useRouteProgress(count = 6): RouteProgress | null {
  const route = useRoute();
  const [progress, setProgress] = useState<RouteProgress | null>(null);
  const hint = useRef<number | undefined>(undefined);
  const last = useRef(0);

  useEffect(() => {
    hint.current = undefined;
    last.current = 0;
    const p = store.state.fast.placement;
    setProgress(route && p ? progressOf(routeModel(route), p.x, p.z, undefined, count) : null);
  }, [route, count]);

  useFastValue(
    (f) => f.placement,
    (p) => {
      if (!route || !p) return;
      const now = performance.now();
      if (now - last.current < 250) return;
      last.current = now;
      const r = progressOf(routeModel(route), p.x, p.z, hint.current, count);
      if (r) hint.current = r.index;
      setProgress(r);
    },
  );
  return route ? progress : null;
}

// ─── teksty ───

export const MANEUVER_TEXT: Record<ManeuverKind, string> = {
  straight: "Prosto",
  keepLeft: "Trzymaj się lewej",
  keepRight: "Trzymaj się prawej",
  slightLeft: "Lekko w lewo",
  slightRight: "Lekko w prawo",
  left: "Skręć w lewo",
  right: "Skręć w prawo",
  sharpLeft: "Ostro w lewo",
  sharpRight: "Ostro w prawo",
  uturn: "Zawróć",
  ferry: "Wjedź na prom",
  arrive: "Cel",
};

/** Dystans do manewru: < 1 km w metrach (zaokrąglone do 10/50 m), dalej jak `formatDistance`. */
export function formatManeuverDistance(m: number, imperial = false): string {
  if (imperial) {
    const mi = m / 1609.344;
    if (mi < 0.2) return `${Math.max(10, Math.round((m * 3.28084) / 50) * 50)} ft`;
    return mi < 10 ? `${mi.toFixed(1).replace(".", ",")} mi` : `${Math.round(mi)} mi`;
  }
  if (m < 1000) {
    const step = m < 200 ? 10 : 50;
    return `${Math.max(step, Math.round(m / step) * step)} m`;
  }
  const km = m / 1000;
  return km < 10 ? `${km.toFixed(1).replace(".", ",")} km` : `${Math.round(km)} km`;
}

/** „za 300 m skręć w prawo” / „prosto przez 200 km” — opis odcinka do manewru. */
export function legText(u: UpcomingManeuver, imperial = false): string {
  const d = formatManeuverDistance(u.leg, imperial);
  return u.maneuver.kind === "arrive" ? `${d} do celu` : `${d}, potem ${MANEUVER_TEXT[u.maneuver.kind].toLowerCase()}`;
}
