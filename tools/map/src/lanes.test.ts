import { describe, expect, it } from "vitest";
import { DEFAULT_PROJECTION } from "../../../apps/yoga/src/features/map/projection.ts";
import { LANE_W, curve, laneLook, pxPerGameMeter } from "./lanes.ts";

describe("map:lanes", () => {
  it("liczy tylko pasy jezdne; klasa drogi i pas rozdzielający", () => {
    expect(
      laneLook({
        token: "a",
        lanesLeft: ["traffic_lane.road.motorway", "traffic_lane.road.motorway"],
        lanesRight: ["traffic_lane.road.motorway", "traffic_lane.road.motorway", "traffic_lane.rail.tram"],
        offset: 2,
      }),
    ).toEqual({ l: 2, r: 2, w: LANE_W, o: 2, c: 2 });
    expect(laneLook({ token: "b", lanesLeft: [], lanesRight: ["traffic_lane.road.local"] })).toEqual({ l: 0, r: 1, w: LANE_W, o: 0, c: 0 });
    expect(laneLook({ token: "c", lanesLeft: ["traffic_lane.rail.train"], lanesRight: [] })).toBeNull();
    // most / „niewidzialna” droga i wjazd bez ruchu też są rysowane
    expect(laneLook({ token: "e", lanesLeft: [], lanesRight: ["traffic_lane.slow_road"] })!.r).toBe(1);
    expect(laneLook({ token: "f", lanesLeft: ["traffic_lane.no_vehicles"], lanesRight: ["traffic_lane.no_vehicles"] })).toMatchObject({ l: 1, r: 1 });
    expect(laneLook({ token: "d", lanesLeft: ["traffic_lane.road.local.narrow"], lanesRight: ["traffic_lane.road.local.narrow"] })!.w).toBeLessThan(LANE_W);
  });
  it("krzywa: końce zachowane, prosto bez punktów pośrednich", () => {
    const a = { uid: "a", x: 0, y: 0, rotation: -Math.PI / 2 };
    const b = { uid: "b", x: 0, y: -100, rotation: -Math.PI / 2 };
    expect(curve(a, b)).toEqual([
      [0, 0],
      [0, -100],
    ]);
    const c = { uid: "c", x: 100, y: -100, rotation: 0 };
    const pts = curve(a, c);
    expect(pts.length).toBeGreaterThan(3);
    expect(pts[0]).toEqual([0, 0]);
    expect(pts.at(-1)).toEqual([100, -100]);
  });
  it("skala: px na metr gry przy zoomie 10 w rozsądnym zakresie (~0,2–0,8)", () => {
    const k = pxPerGameMeter(0, 0, DEFAULT_PROJECTION);
    expect(k).toBeGreaterThan(0.2);
    expect(k).toBeLessThan(0.8);
  });
});
