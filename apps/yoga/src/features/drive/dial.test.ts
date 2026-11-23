import { describe, expect, it } from "vitest";
import { A0, ARC, angleOf, arcPath, rpmScale, scaleTicks, speedScale } from "./dial.ts";

describe("geometria zegarów", () => {
  it("kąt: min na początku łuku, max na końcu, poza skalą przycięte", () => {
    expect(angleOf(0, 0, 140)).toBe(A0);
    expect(angleOf(140, 0, 140)).toBe(A0 + ARC);
    expect(angleOf(70, 0, 140)).toBeCloseTo(0);
    expect(angleOf(-5, 0, 140)).toBe(A0);
    expect(angleOf(999, 0, 140)).toBe(A0 + ARC);
  });

  it("łuk ponad 180° ma flagę dużego łuku", () => {
    expect(arcPath(A0, A0 + ARC, 90)).toContain(" 0 1 1 ");
    expect(arcPath(0, 90, 90)).toContain(" 0 0 1 ");
  });

  it("podziałki: główne co 20 z pośrednimi co 10", () => {
    const t = scaleTicks(0, 140, 20, 1);
    expect(t).toHaveLength(15);
    expect(t.filter((x) => x.major).map((x) => x.value)).toEqual([0, 20, 40, 60, 80, 100, 120, 140]);
  });

  it("skala prędkości wg jednostek", () => {
    expect(speedScale({ speed: "kmh" })).toEqual({ max: 140, major: 20, minor: 1 });
    expect(speedScale({ speed: "mph" }).max).toBe(90);
  });

  it("obrotomierz z limitu: skala do 3000, eko 1000–1500, czerwone od 2250; brak limitu → domyślne 2500", () => {
    expect(rpmScale(2500)).toEqual({ max: 3000, major: 500, minor: 4, eco: [1000, 1500], red: 2250 });
    expect(rpmScale(0)).toEqual(rpmScale(2500));
    expect(rpmScale(2100).max).toBe(2500);
  });
});
