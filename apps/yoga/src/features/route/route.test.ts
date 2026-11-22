import { describe, expect, it } from "vitest";
import { WORLD_SCALE, CITY_SCALE, type RouteInfo } from "@yoga-auto/protocol";
import { formatManeuverDistance, progressOf, routeModel } from "./model.ts";

// odcinek 1000 m na północ (poza miastem), skręt w prawo, 200 m na wschód w mieście, cel
const route: RouteInfo = {
  id: "t",
  to: { city: "X", company: "Y" },
  points: [0, 0, 0, -1000, 200, -1000],
  city: [1, 2],
  length: 1200,
  duration: 60,
  maneuvers: [
    { at: 1000, kind: "right", angle: 90 },
    { at: 1200, kind: "arrive", angle: 0 },
  ],
  computedAt: 0,
};

describe("postęp na trasie", () => {
  it("dystanse w skali gry: poza miastem ×19, w mieście ×3", () => {
    const p = progressOf(routeModel(route), 0, -400)!;
    expect(p.along).toBeCloseTo(400);
    expect(p.offset).toBeCloseTo(0);
    expect(p.upcoming.map((u) => u.maneuver.kind)).toEqual(["right", "arrive"]);
    expect(p.upcoming[0]!.distance).toBeCloseTo(600 * WORLD_SCALE);
    expect(p.upcoming[1]!.leg).toBeCloseTo(200 * CITY_SCALE);
    expect(p.remaining).toBeCloseTo(600 * WORLD_SCALE + 200 * CITY_SCALE);
  });
  it("minięty manewr znika z listy", () => {
    const p = progressOf(routeModel(route), 100, -1000)!;
    expect(p.upcoming.map((u) => u.maneuver.kind)).toEqual(["arrive"]);
    expect(p.upcoming[0]!.distance).toBeCloseTo(100 * CITY_SCALE);
  });
  it("odsunięcie od trasy", () => {
    expect(progressOf(routeModel(route), 80, -500)!.offset).toBeCloseTo(80);
  });
});

describe("formatManeuverDistance", () => {
  it("metry poniżej 1 km, km powyżej", () => {
    expect(formatManeuverDistance(96)).toBe("100 m");
    expect(formatManeuverDistance(330)).toBe("350 m");
    expect(formatManeuverDistance(4)).toBe("10 m");
    expect(formatManeuverDistance(2540)).toBe("2,5 km");
    expect(formatManeuverDistance(201_400)).toBe("201 km");
  });
  it("mile", () => {
    expect(formatManeuverDistance(150, true)).toBe("500 ft");
    expect(formatManeuverDistance(17_000, true)).toBe("11 mi");
  });
});
