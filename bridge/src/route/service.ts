/**
 * RouteService: utrzymuje bieżącą trasę GPS.
 * Cel: punkt wybrany ręcznie na tablecie (`route.set`), firma docelowa zlecenia albo — przy kursie autobusowym —
 * centrum miasta następnego przystanku (dworców nie ma w danych mapy). Ręczny cel ma pierwszeństwo,
 * ale nowe zlecenie go zastępuje (gra nie udostępnia celu ustawionego w jej GPS, więc bez zlecenia cel wybiera się na tablecie).
 * - nowy cel → liczy trasę od bieżącej pozycji,
 * - zjazd z trasy (> OFF_ROUTE_M przez OFF_ROUTE_MS) → przelicza (nie częściej niż co REPLAN_MIN_MS),
 * - dojazd do ręcznego celu (postój w promieniu ARRIVED_M) → kończy nawigację,
 * - brak celu → trasa `null`.
 * `update()` zwraca nową trasę (także `null`), gdy trzeba ją rozesłać, albo `undefined`, gdy bez zmian.
 */
import { cumulative, projectOnRoute, type FullState, type RouteInfo, type RouteTarget } from "@yoga-auto/protocol";
import { companyNodes, type RouteGraph } from "./graph.ts";
import { buildRoute, planRoute } from "./planner.ts";

export const OFF_ROUTE_M = 45;
export const OFF_ROUTE_MS = 2500;
export const REPLAN_MIN_MS = 4000;
/** cel nieosiągalny / brak pozycji: ponowna próba co tyle ms */
export const RETRY_MS = 15_000;
/** m świata: postój tak blisko ręcznego celu = dojechano */
export const ARRIVED_M = 50;

interface Target {
  key: string;
  goals: number[];
  to: RouteInfo["to"];
  manual: boolean;
}

/** Węzły grafu najbliżej punktu (z wyjazdem), z poszerzaniem promienia. */
export function goalsNear(g: RouteGraph, x: number, z: number): number[] {
  for (const r of [150, 500, 2000, 6000]) {
    const near = g.grid.near(x, z, r).filter(({ node }) => g.off[node * 2] !== g.off[node * 2 + 2]);
    // tylko węzły tuż przy wskazanym punkcie (np. pasy tej samej drogi), nie skrzyżowanie obok
    if (near.length) return near.filter((n) => n.d <= near[0]!.d + 30).slice(0, 4).map((n) => n.node);
  }
  return [];
}

/** Środki miast po tokenie (z `route-places.json`): cele przystanków kursów autobusowych. */
export type CityCenters = ReadonlyMap<string, { x: number; z: number }>;

/** Wczytuje środki miast z `route-places.json` (krotki [nazwa, x, z, kraj, token]); stare pliki bez tokenów = pusto. */
export function cityCentersFrom(places: unknown): Map<string, { x: number; z: number }> {
  const out = new Map<string, { x: number; z: number }>();
  const cities = (places as { cities?: unknown } | null)?.cities;
  if (!Array.isArray(cities)) return out;
  for (const c of cities) {
    if (Array.isArray(c) && typeof c[4] === "string" && typeof c[1] === "number" && typeof c[2] === "number")
      out.set(c[4], { x: c[1], z: c[2] });
  }
  return out;
}

export class RouteService {
  route: RouteInfo | null = null;
  /** cel wybrany na tablecie */
  manual: RouteTarget | null = null;
  private cum: Float64Array | null = null;
  private hint: number | undefined;
  private key: string | null = null;
  private lastJobKey: string | null = null;
  private offSince = 0;
  private lastPlanAt = -Infinity;
  private missingLogged = new Set<string>();
  private readonly graph: RouteGraph;
  private readonly cities: CityCenters;
  private readonly log: (level: "debug" | "info" | "warn" | "error", msg: string) => void;

  constructor(
    graph: RouteGraph,
    log: (level: "debug" | "info" | "warn" | "error", msg: string) => void = () => {},
    cities: CityCenters = new Map(),
  ) {
    this.graph = graph;
    this.log = log;
    this.cities = cities;
  }

  /** Ręczny cel (null = zakończ nawigację do punktu). Trasa liczy się przy najbliższym `update()`. */
  setManual(target: RouteTarget | null): void {
    this.manual = target;
    this.log("info", target ? `route: cel ręczny „${target.label}” (${Math.round(target.x)}, ${Math.round(target.z)})` : "route: cel ręczny wyczyszczony");
  }

  private target(state: FullState): Target | null {
    const job = state.config.job;
    const jobKey = job ? `${job.destination.cityId}/${job.destination.companyId}` : null;
    // nowe zlecenie zastępuje ręczny cel
    if (jobKey && jobKey !== this.lastJobKey && this.manual) {
      this.log("info", "route: nowe zlecenie zastępuje cel ręczny");
      this.manual = null;
    }
    this.lastJobKey = jobKey;
    const m = this.manual;
    if (m) {
      return {
        key: `m:${m.x.toFixed(0)},${m.z.toFixed(0)}`,
        goals: goalsNear(this.graph, m.x, m.z),
        to: { city: m.label, company: "" },
        manual: true,
      };
    }
    if (!job || !jobKey) return null;
    if (job.kind === "bus") {
      // przystanek = miasto (gra podaje token miasta); prowadzimy do jego centrum, dokładne miejsce zna GPS gry
      const c = this.cities.get(job.destination.cityId);
      if (!c && !this.missingLogged.has(jobKey)) {
        this.missingLogged.add(jobKey);
        this.log("warn", `route: brak miasta ${job.destination.cityId} w route-places.json (npm run map:graph -- --places-only)`);
      }
      return {
        key: `b:${job.destination.cityId}`,
        goals: c ? goalsNear(this.graph, c.x, c.z) : [],
        to: { city: job.destination.city, company: "przystanek" },
        manual: false,
      };
    }
    const goals = companyNodes(this.graph, job.destination.cityId, job.destination.companyId);
    if (!goals.length && !this.missingLogged.has(jobKey)) {
      this.missingLogged.add(jobKey);
      this.log("warn", `route: brak firmy ${jobKey} w grafie (stary graf / DLC?)`);
    }
    return { key: `j:${jobKey}`, goals, to: { city: job.destination.city, company: job.destination.company }, manual: false };
  }

  update(state: FullState, now: number): RouteInfo | null | undefined {
    const p = state.fast.placement;
    // dojazd do ręcznego celu: postój blisko punktu
    if (this.manual && p && Math.hypot(p.x - this.manual.x, p.z - this.manual.z) < ARRIVED_M && Math.abs(state.fast.speed) < 0.5) {
      this.log("info", `route: dojechano do „${this.manual.label}”`);
      this.manual = null;
    }
    const target = this.target(state);
    if (!target) {
      this.key = null;
      if (this.route === null) return undefined;
      return this.set(null);
    }
    if (!p) return undefined;

    if (target.key !== this.key) {
      this.key = target.key;
      this.lastPlanAt = -Infinity;
      return this.plan(target, state, now);
    }
    if (!this.route) {
      return now - this.lastPlanAt >= RETRY_MS ? this.plan(target, state, now) : undefined;
    }
    const pr = projectOnRoute(this.route.points, this.cum!, p.x, p.z, this.hint);
    const full = pr && pr.offset > OFF_ROUTE_M ? projectOnRoute(this.route.points, this.cum!, p.x, p.z) : pr;
    if (full) this.hint = full.index;
    if (!full || full.offset <= OFF_ROUTE_M) {
      this.offSince = 0;
      return undefined;
    }
    if (!this.offSince) this.offSince = now;
    if (now - this.offSince >= OFF_ROUTE_MS && now - this.lastPlanAt >= REPLAN_MIN_MS) {
      this.log("info", `route: zjazd z trasy (${Math.round(full.offset)} m), przeliczam`);
      return this.plan(target, state, now);
    }
    return undefined;
  }

  private plan(target: Target, state: FullState, now: number): RouteInfo | null | undefined {
    this.lastPlanAt = now;
    this.offSince = 0;
    const p = state.fast.placement!;
    if (!target.goals.length) return this.route === null ? undefined : this.set(null);
    const t0 = performance.now();
    const plan = planRoute(this.graph, p, target.goals);
    const ms = performance.now() - t0;
    if (!plan) {
      this.log("warn", `route: nie znaleziono trasy do ${target.to.city} (${ms.toFixed(0)} ms)`);
      return this.route === null ? undefined : this.set(null);
    }
    const built = buildRoute(this.graph, plan, p);
    this.log(
      "info",
      `route: ${target.to.city} ${(built.length / 1000).toFixed(1)} km, ${built.maneuvers.length} manewrów, ${built.points.length / 2} pkt (${ms.toFixed(0)} ms)`,
    );
    return this.set({
      id: `${now.toString(36)}`,
      to: target.to,
      ...(target.manual ? { manual: true } : {}),
      points: built.points,
      city: built.city,
      length: Math.round(built.length),
      duration: Math.round(built.duration),
      maneuvers: built.maneuvers,
      computedAt: now,
    });
  }

  private set(route: RouteInfo | null): RouteInfo | null {
    this.route = route;
    this.cum = route ? cumulative(route.points) : null;
    this.hint = undefined;
    return route;
  }
}
