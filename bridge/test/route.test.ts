import { describe, expect, it } from "vitest";
import { cumulative, emptyFullState, gameCumulative, projectOnRoute, type JobConfig } from "@yoga-auto/protocol";
import { EDGE_FERRY, EDGE_ROAD, NODE_CITY, buildGraph, companyNodes, decodeGraph, encodeGraph } from "../src/route/graph.ts";
import { buildRoute, classifyTurn, hermite, planRoute, simplify, turnAngle } from "../src/route/planner.ts";
import { OFF_ROUTE_MS, RouteService, goalsNear } from "../src/route/service.ts";
import { isRouteTarget } from "../src/guards.ts";

/**
 * Skrzyżowanie „+” (oś z gry rośnie na południe, więc północ = −z):
 *        E(0,-200)
 *          |
 * C(-100,-100) — B(0,-100) — D(100,-100)
 *          |
 *        A(0,0)
 * Jazda na północ z A; z B można w lewo (C), prosto (E) albo w prawo (D). Przejazd przez B to „prefab” (bez EDGE_ROAD).
 * Dodatkowo długi odcinek drogi D → F(100,-5000) w mieście (D i F w obszarze miasta — test skali).
 */
function cross() {
  const x = [0, 0, -100, 100, 0, 100];
  const z = [0, -100, -100, -100, -200, -5000];
  const A = 0, B = 1, C = 2, D = 3, E = 4, F = 5;
  const fw = (n: number) => n * 2;
  const bw = (n: number) => n * 2 + 1;
  const edges: [number, number, number, number, number][] = [
    [fw(A), fw(B), 100, 10, EDGE_ROAD],
    [fw(B), fw(C), 100, 10, 0],
    [fw(B), fw(D), 100, 10, 0],
    [fw(B), fw(E), 100, 10, 0],
    [fw(D), fw(F), 4900, 200, EDGE_ROAD],
    // powrót (kierunek „backward”)
    [bw(B), bw(A), 100, 10, EDGE_ROAD],
    [bw(E), bw(B), 100, 10, 0],
  ];
  const nodeFlags = [0, 0, 0, NODE_CITY, 0, NODE_CITY];
  const g = buildGraph({
    x,
    z,
    nodeFlags,
    edges,
    companies: [
      ["west", "c", C],
      ["east", "d", D],
      ["north", "e", E],
      ["far", "f", F],
    ],
  });
  return { g, A, B, C, D, E, F };
}

const north = { x: 0, z: 10, heading: 0 }; // tuż za A, przodem na północ

describe("route graph", () => {
  it("encode → decode zachowuje dane", () => {
    const { g } = cross();
    const g2 = decodeGraph(encodeGraph(g));
    expect(g2.n).toBe(g.n);
    expect([...g2.off]).toEqual([...g.off]);
    expect([...g2.to]).toEqual([...g.to]);
    expect([...g2.flags]).toEqual([...g.flags]);
    expect([...g2.nodeFlags]).toEqual([...g.nodeFlags]);
    expect(companyNodes(g2, "east", "d")).toEqual([3]);
  });
  it("zły plik → błąd", () => {
    expect(() => decodeGraph(Buffer.from("nope"))).toThrow();
  });
  it("siatka przestrzenna zwraca węzły wg odległości", () => {
    const { g } = cross();
    expect(g.grid.near(0, -90, 30).map((n) => n.node)).toEqual([1]);
    expect(g.grid.near(0, -100, 101).map((n) => n.node).slice(0, 1)).toEqual([1]);
  });
});

describe("planRoute + buildRoute", () => {
  it("skręt w prawo: B → D", () => {
    const { g, D } = cross();
    const plan = planRoute(g, north, [D])!;
    expect(plan).not.toBeNull();
    expect(plan.states.map((s) => s >> 1)).toEqual([1, 3]); // start na końcu krawędzi A→B, na której stoi ciężarówka
    const r = buildRoute(g, plan, north);
    expect(r.maneuvers.map((m) => m.kind)).toEqual(["right", "arrive"]);
    expect(r.maneuvers[0]!.at).toBeCloseTo(110, 0);
    expect(r.length).toBeCloseTo(210, 0);
  });
  it("skręt w lewo: B → C", () => {
    const { g, C } = cross();
    const r = buildRoute(g, planRoute(g, north, [C])!, north);
    expect(r.maneuvers.map((m) => m.kind)).toEqual(["left", "arrive"]);
  });
  it("prosto przez skrzyżowanie: bez manewru, tylko cel", () => {
    const { g, E } = cross();
    const r = buildRoute(g, planRoute(g, north, [E])!, north);
    expect(r.maneuvers.map((m) => m.kind)).toEqual(["arrive"]);
  });
  it("cel nieosiągalny / brak celu → null", () => {
    const { g, A } = cross();
    expect(planRoute(g, north, [])).toBeNull();
    // A jest za plecami i nie ma krawędzi wjazdowej w kierunku forward
    expect(planRoute(g, { x: 5000, z: 5000, heading: 0 }, [A])).toBeNull();
  });
  it("odcinki w mieście są oznaczone (skala odległości gry)", () => {
    const { g, F } = cross();
    const r = buildRoute(g, planRoute(g, north, [F])!, north);
    expect(r.city.length).toBe(2);
    const gc = gameCumulative(r.points, r.city);
    const wc = cumulative(r.points);
    // 210 m poza miastem ×19 + 4900 m w mieście ×3
    expect(gc[gc.length - 1]!).toBeCloseTo(210 * 19 + 4900 * 3, -1);
    expect(wc[wc.length - 1]!).toBeCloseTo(5110, 0);
  });
});

describe("geometria", () => {
  it("turnAngle: + = w prawo (z na południe)", () => {
    expect(turnAngle(0, 0, 0, -10, 10, -10)).toBeCloseTo(90);
    expect(turnAngle(0, 0, 0, -10, -10, -10)).toBeCloseTo(-90);
    expect(turnAngle(0, 0, 0, -10, 0, -20)).toBeCloseTo(0);
  });
  it("classifyTurn", () => {
    expect(classifyTurn(5, true)).toBe("straight");
    expect(classifyTurn(15, true)).toBe("keepRight");
    expect(classifyTurn(-30, false)).toBe("slightLeft");
    expect(classifyTurn(90, false)).toBe("right");
    expect(classifyTurn(-130, false)).toBe("sharpLeft");
    expect(classifyTurn(175, false)).toBe("uturn");
  });
  it("hermite: łuk drogi zamiast cięciwy (styczne z obrotów węzłów)", () => {
    // a: jazda na północ (styczna (0,−1) → rot −π/2), b: na wschód (rot 0) — zakręt w prawo
    const g = buildGraph({ x: [0, 100], z: [0, -100], rot: [-Math.PI / 2, 0], edges: [] });
    const out: number[] = [];
    hermite(g, 0, 1, out);
    expect(out.length).toBeGreaterThan(4);
    const mid = out.length / 2 % 2 === 0 ? out.length / 2 : out.length / 2 - 1;
    // środek łuku leży po zewnętrznej (północno-zachodniej) stronie cięciwy x = −z
    expect(out[mid]! + out[mid + 1]!).toBeLessThan(0);
    // prosto: nic nie dodaje
    const straight: number[] = [];
    hermite(buildGraph({ x: [0, 0], z: [0, -100], rot: [Math.PI / 2, -Math.PI / 2], edges: [] }), 0, 1, straight);
    expect(straight).toEqual([]);
  });
  it("simplify zachowuje końce i punkty obowiązkowe", () => {
    const pts = [0, 0, 1, 0.1, 2, 0, 3, 0.1, 4, 0];
    expect(simplify(pts, 1).points).toEqual([0, 0, 4, 0]);
    expect(simplify(pts, 1, new Set([2])).points).toEqual([0, 0, 2, 0, 4, 0]);
  });
  it("projectOnRoute: dystans wzdłuż i odsunięcie", () => {
    const pts = [0, 0, 100, 0, 100, 100];
    const cum = cumulative(pts);
    const p = projectOnRoute(pts, cum, 50, 5)!;
    expect(p.along).toBeCloseTo(50);
    expect(p.offset).toBeCloseTo(5);
    expect(projectOnRoute(pts, cum, 105, 60)!.along).toBeCloseTo(160);
  });
});

describe("RouteService", () => {
  const job = (city: string, company: string): JobConfig => ({
    cargo: "x",
    cargoId: "x",
    mass: 1,
    income: 1,
    deliveryTime: null,
    plannedDistanceKm: 1,
    source: { city: "A", cityId: "a", company: "A", companyId: "a" },
    destination: { city: city.toUpperCase(), cityId: city, company: company.toUpperCase(), companyId: company },
    market: "cargo_market",
    special: false,
    cargoLoaded: true,
  });

  it("liczy trasę po przyjęciu zlecenia, kasuje po jego końcu", () => {
    const { g } = cross();
    const svc = new RouteService(g);
    const st = emptyFullState();
    st.fast.placement = { ...north, y: 0 };
    expect(svc.update(st, 0)).toBeUndefined(); // brak zlecenia, brak trasy → bez zmian
    st.config.job = job("east", "d");
    const r = svc.update(st, 100)!;
    expect(r.to.city).toBe("EAST");
    expect(r.maneuvers.map((m) => m.kind)).toEqual(["right", "arrive"]);
    expect(svc.update(st, 350)).toBeUndefined(); // na trasie: bez zmian
    st.config.job = null;
    expect(svc.update(st, 600)).toBeNull();
  });

  it("zjazd z trasy → przeliczenie po OFF_ROUTE_MS", () => {
    const { g } = cross();
    const svc = new RouteService(g);
    const st = emptyFullState();
    st.fast.placement = { ...north, y: 0 };
    st.config.job = job("east", "d");
    const first = svc.update(st, 0)!;
    // ciężarówka 80 m w bok od trasy, nadal przodem na północ
    st.fast.placement = { x: -80, y: 0, z: -50, heading: 0 };
    expect(svc.update(st, 10_000)).toBeUndefined();
    const again = svc.update(st, 10_000 + OFF_ROUTE_MS + 1);
    expect(again).toBeTruthy();
    expect(again!.id).not.toBe(first.id);
  });

  it("nieznana firma → brak trasy, bez wyjątku", () => {
    const { g } = cross();
    const svc = new RouteService(g);
    const st = emptyFullState();
    st.fast.placement = { ...north, y: 0 };
    st.config.job = job("nowhere", "zzz");
    expect(svc.update(st, 0)).toBeUndefined();
    expect(svc.route).toBeNull();
  });

  it("prom oznaczony jako manewr", () => {
    const g = buildGraph({
      x: [0, 0, 0],
      z: [0, -100, -3000],
      edges: [
        [0, 2, 100, 10, EDGE_ROAD],
        [2, 4, 2900, 600, EDGE_FERRY],
      ],
      companies: [["isle", "port", 2]],
    });
    const r = buildRoute(g, planRoute(g, north, [2])!, north);
    expect(r.maneuvers.map((m) => m.kind)).toEqual(["ferry", "arrive"]);
  });
});

describe("ręczny cel (route.set)", () => {
  const jobTo = (city: string, company: string): JobConfig => ({
    cargo: "x",
    cargoId: "x",
    mass: 1,
    income: 1,
    deliveryTime: null,
    plannedDistanceKm: 1,
    source: { city: "A", cityId: "a", company: "A", companyId: "a" },
    destination: { city, cityId: city, company, companyId: company },
    market: "cargo_market",
    special: false,
    cargoLoaded: true,
  });

  it("bez zlecenia: trasa do punktu z mapy", () => {
    const { g } = cross();
    const svc = new RouteService(g);
    const st = emptyFullState();
    st.fast.placement = { ...north, y: 0 };
    svc.setManual({ x: 95, z: -95, label: "Punkt" });
    const r = svc.update(st, 0)!;
    expect(r.manual).toBe(true);
    expect(r.to.city).toBe("Punkt");
    expect(r.maneuvers.map((m) => m.kind)).toEqual(["right", "arrive"]);
    svc.setManual(null);
    expect(svc.update(st, 100)).toBeNull();
  });

  it("ręczny cel ma pierwszeństwo przed trwającym zleceniem, nowe zlecenie go zastępuje", () => {
    const { g } = cross();
    const svc = new RouteService(g);
    const st = emptyFullState();
    st.fast.placement = { ...north, y: 0 };
    st.config.job = jobTo("west", "c");
    expect(svc.update(st, 0)!.maneuvers[0]!.kind).toBe("left");
    svc.setManual({ x: 100, z: -100, label: "D" });
    expect(svc.update(st, 10)!.maneuvers[0]!.kind).toBe("right");
    st.config.job = jobTo("north", "e"); // nowe zlecenie
    const r = svc.update(st, 20)!;
    expect(r.manual).toBeUndefined();
    expect(svc.manual).toBeNull();
    expect(r.maneuvers.map((m) => m.kind)).toEqual(["arrive"]);
  });

  it("postój przy ręcznym celu kończy nawigację", () => {
    const { g } = cross();
    const svc = new RouteService(g);
    const st = emptyFullState();
    st.fast.placement = { ...north, y: 0 };
    svc.setManual({ x: 100, z: -100, label: "D" });
    expect(svc.update(st, 0)).toBeTruthy();
    st.fast.placement = { x: 90, y: 0, z: -100, heading: 0.75 };
    st.fast.speed = 0;
    expect(svc.update(st, 1000)).toBeNull();
    expect(svc.manual).toBeNull();
  });

  it("goalsNear: najbliższe węzły z wyjazdem", () => {
    const { g } = cross();
    expect(goalsNear(g, 99, -99)[0]).toBe(3);
    expect(goalsNear(g, 1e5, 1e5)).toEqual([]);
  });

  it("walidacja celu z sieci", () => {
    expect(isRouteTarget({ x: 1, z: 2, label: "a" })).toBe(true);
    expect(isRouteTarget({ x: Number.NaN, z: 2, label: "a" })).toBe(false);
    expect(isRouteTarget({ x: 1, z: 2 })).toBe(false);
    expect(isRouteTarget({ x: 1e9, z: 2, label: "a" })).toBe(false);
    expect(isRouteTarget(null)).toBe(false);
  });
});
