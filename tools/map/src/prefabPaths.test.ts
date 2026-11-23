import { describe, expect, it } from "vitest";
import { curvePath, fitPrefab, prefabEdgePath, sampleCurves, simplifyFlat, toWorld, type PrefabDesc } from "./prefabPaths.ts";

/**
 * Prefab „zakręt 90°” w układzie lokalnym: węzeł 0 na (0, 30) — wjazd w dół (−y), węzeł 1 na (30, 0) — wyjazd w prawo.
 * Krzywa 0: pas 0 → 1 (z przesunięciem 2 m jak środek pasa), krzywa 1: z powrotem. Krzywa 2 → 3: ciąg (nextLines).
 */
const DESC: PrefabDesc = {
  token: "turn90",
  nodes: [
    { x: 0, y: 30, rotation: -Math.PI / 2, inputLanes: [0], outputLanes: [1] },
    { x: 30, y: 0, rotation: 0, inputLanes: [1], outputLanes: [0] },
  ],
  navCurves: [
    { start: { x: 2, y: 30, rotation: -Math.PI / 2 }, end: { x: 30, y: 2, rotation: 0 }, nextLines: [] },
    { start: { x: 30, y: -2, rotation: Math.PI }, end: { x: -2, y: 30, rotation: Math.PI / 2 }, nextLines: [] },
  ],
};

/** Świat: obrót o 90° i przesunięcie (opcjonalnie odbicie y). */
function place(mirror: boolean) {
  const th = Math.PI / 2;
  const f = { perm: [0, 1], mirror, cos: Math.cos(th), sin: Math.sin(th), tx: 1000, tz: 500, err: 0 };
  return DESC.nodes.map((n) => {
    const [x, z] = toWorld(f, n.x, n.y);
    return { x, z };
  });
}

describe("prefabPaths", () => {
  it("dopasowanie: obrót + przesunięcie (i odbicie) z błędem ~0; zła geometria → null", () => {
    for (const mirror of [false, true]) {
      const w = place(mirror);
      const f = fitPrefab(DESC, w)!;
      expect(f).not.toBeNull();
      expect(f.err).toBeLessThan(1e-6);
      expect(f.perm[0]).toBe(0);
      const [x, z] = toWorld(f, 30, 0);
      expect(x).toBeCloseTo(w[1]!.x, 6);
      expect(z).toBeCloseTo(w[1]!.z, 6);
    }
    expect(fitPrefab(DESC, [{ x: 0, z: 0 }, { x: 0, z: 100 }])).toBeNull(); // rozstaw 100 m zamiast 42 m
  });

  it("ciąg krzywych: najkrótszy od pasów wjazdu do pasów wyjazdu, po nextLines", () => {
    expect(curvePath(DESC, 0, 1)).toEqual([0]);
    expect(curvePath(DESC, 1, 0)).toEqual([1]);
    const chain: PrefabDesc = {
      token: "chain",
      nodes: [
        { x: 0, y: 0, rotation: 0, inputLanes: [0, 3], outputLanes: [] },
        { x: 40, y: 0, rotation: 0, inputLanes: [], outputLanes: [2] },
      ],
      navCurves: [
        { start: { x: 0, y: 0, rotation: 0 }, end: { x: 10, y: 0, rotation: 0 }, nextLines: [1] },
        { start: { x: 10, y: 0, rotation: 0 }, end: { x: 30, y: 0, rotation: 0 }, nextLines: [2] },
        { start: { x: 30, y: 0, rotation: 0 }, end: { x: 40, y: 0, rotation: 0 }, nextLines: [] },
        { start: { x: 0, y: 0, rotation: 0 }, end: { x: 0, y: 50, rotation: 0 }, nextLines: [] }, // ślepy pas
      ],
    };
    expect(curvePath(chain, 0, 1)).toEqual([0, 1, 2]);
    expect(curvePath(chain, 1, 0)).toBeNull();
  });

  it("ścieżka w świecie: łuk (nie cięciwa), końce przyklejone do węzłów, punkty pośrednie bez końców", () => {
    const w = place(false);
    const f = fitPrefab(DESC, w)!;
    const path = prefabEdgePath(DESC, f, 0, 1, w[0]!, w[1]!)!;
    expect(path.length).toBeGreaterThanOrEqual(4);
    // najdalszy punkt od cięciwy węzeł0 → węzeł1: łuk 90° o promieniu ~30 m odchodzi o kilka metrów
    const [ax, az, bx, bz] = [w[0]!.x, w[0]!.z, w[1]!.x, w[1]!.z];
    const L = Math.hypot(bx - ax, bz - az);
    let dev = 0;
    for (let i = 0; i < path.length; i += 2) dev = Math.max(dev, Math.abs((bx - ax) * (az - path[i + 1]!) - (ax - path[i]!) * (bz - az)) / L);
    expect(dev).toBeGreaterThan(5);
    // punkty w obrębie prefabu (nie „ucieka” poza zakręt)
    for (let i = 0; i < path.length; i += 2) {
      expect(path[i]!).toBeGreaterThan(965);
      expect(path[i]!).toBeLessThan(1035);
    }
  });

  it("próbkowanie i uproszczenie: prosta krzywa → same końce", () => {
    const straight: PrefabDesc = {
      token: "s",
      nodes: [],
      navCurves: [{ start: { x: 0, y: 0, rotation: 0 }, end: { x: 30, y: 0, rotation: 0 }, nextLines: [] }],
    };
    const pts = sampleCurves(straight, [0]);
    expect(pts.slice(0, 2)).toEqual([0, 0]);
    expect(pts.slice(-2)).toEqual([30, 0]);
    expect(simplifyFlat(pts, 0.1)).toEqual([0, 0, 30, 0]);
  });
});
