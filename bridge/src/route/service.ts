/**
 * RouteService: utrzymuje bieżącą trasę GPS do firmy docelowej zlecenia.
 * - nowe zlecenie (inny cel) → liczy trasę od bieżącej pozycji,
 * - zjazd z trasy (> OFF_ROUTE_M przez OFF_ROUTE_MS) → przelicza (nie częściej niż co REPLAN_MIN_MS),
 * - brak zlecenia → trasa `null`.
 * `update()` zwraca nową trasę (także `null`), gdy trzeba ją rozesłać, albo `undefined`, gdy bez zmian.
 */
import { cumulative, projectOnRoute, type FullState, type RouteInfo } from "@yoga-auto/protocol";
import { companyNodes, type RouteGraph } from "./graph.ts";
import { buildRoute, planRoute } from "./planner.ts";

export const OFF_ROUTE_M = 45;
export const OFF_ROUTE_MS = 2500;
export const REPLAN_MIN_MS = 4000;
/** cel nieosiągalny / brak pozycji: ponowna próba co tyle ms */
export const RETRY_MS = 15_000;

export class RouteService {
  route: RouteInfo | null = null;
  private cum: Float64Array | null = null;
  private hint: number | undefined;
  private key: string | null = null;
  private offSince = 0;
  private lastPlanAt = -Infinity;
  private missingLogged = new Set<string>();
  private readonly graph: RouteGraph;
  private readonly log: (level: "debug" | "info" | "warn" | "error", msg: string) => void;

  constructor(graph: RouteGraph, log: (level: "debug" | "info" | "warn" | "error", msg: string) => void = () => {}) {
    this.graph = graph;
    this.log = log;
  }

  update(state: FullState, now: number): RouteInfo | null | undefined {
    const job = state.config.job;
    const key = job ? `${job.destination.cityId}/${job.destination.companyId}` : null;
    if (!job || !key) {
      this.key = null;
      if (this.route === null) return undefined;
      return this.set(null);
    }
    const p = state.fast.placement;
    if (!p) return undefined;

    if (key !== this.key) {
      this.key = key;
      this.lastPlanAt = -Infinity;
      return this.plan(state, now);
    }
    if (!this.route) {
      return now - this.lastPlanAt >= RETRY_MS ? this.plan(state, now) : undefined;
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
      return this.plan(state, now);
    }
    return undefined;
  }

  private plan(state: FullState, now: number): RouteInfo | null | undefined {
    this.lastPlanAt = now;
    this.offSince = 0;
    const job = state.config.job!;
    const p = state.fast.placement!;
    const goals = companyNodes(this.graph, job.destination.cityId, job.destination.companyId);
    if (!goals.length) {
      const k = `${job.destination.cityId}/${job.destination.companyId}`;
      if (!this.missingLogged.has(k)) {
        this.missingLogged.add(k);
        this.log("warn", `route: brak firmy ${k} w grafie (stary graf / DLC?)`);
      }
      return this.route === null ? undefined : this.set(null);
    }
    const t0 = performance.now();
    const plan = planRoute(this.graph, p, goals);
    const ms = performance.now() - t0;
    if (!plan) {
      this.log("warn", `route: nie znaleziono trasy do ${job.destination.city} (${ms.toFixed(0)} ms)`);
      return this.route === null ? undefined : this.set(null);
    }
    const built = buildRoute(this.graph, plan, p);
    this.log(
      "info",
      `route: ${job.destination.city} ${(built.length / 1000).toFixed(1)} km, ${built.maneuvers.length} manewrów, ${built.points.length / 2} pkt (${ms.toFixed(0)} ms)`,
    );
    return this.set({
      id: `${now.toString(36)}`,
      to: { city: job.destination.city, company: job.destination.company },
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
