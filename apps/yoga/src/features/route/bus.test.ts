import { describe, expect, it } from "vitest";
import type { BusStage } from "@yoga-auto/protocol";
import { delayMin, stopRows } from "./bus.tsx";

const stop = (id: string) => ({ id, name: id.toUpperCase(), type: "city" });
const stage = (from: string, to: string, extra: Partial<BusStage> = {}): BusStage => ({
  from: stop(from),
  to: stop(to),
  departPlanned: 100,
  departActual: null,
  arrivePlanned: 200,
  arriveActual: null,
  boardingPlanned: 10,
  boardingActual: null,
  alightingPlanned: 5,
  alightingActual: null,
  ...extra,
});

describe("kurs autobusowy: przystanki", () => {
  it("kolejność i stan względem bieżącego etapu", () => {
    const stages = [stage("a", "b", { departActual: 101 }), stage("b", "c"), stage("c", "d")];
    const rows = stopRows(stages, 0);
    expect(rows.map((r) => r.stop.id)).toEqual(["a", "b", "c", "d"]);
    expect(rows.map((r) => r.state)).toEqual(["done", "next", "later", "later"]);
    // przed odjazdem z pierwszego przystanku: „tu jesteś”
    expect(stopRows([stage("a", "b"), stage("b", "c")], 0).map((r) => r.state)).toEqual(["here", "next", "later"]);
    // etap 1 przed odjazdem z B
    expect(stopRows(stages, 1).map((r) => r.state)).toEqual(["done", "here", "next", "later"]);
  });
  it("godziny i pasażerowie: pierwszy = odjazd, pozostałe = przyjazd + odjazd dalej", () => {
    const rows = stopRows([stage("a", "b", { departPlanned: 90, arrivePlanned: 150 }), stage("b", "c", { departPlanned: 160, boardingPlanned: 7 })], 0);
    expect(rows[0]).toMatchObject({ planned: 90, boarding: 10, alighting: null, departPlanned: null });
    expect(rows[1]).toMatchObject({ planned: 150, alighting: 5, boarding: 7, departPlanned: 160 });
    expect(rows[2]).toMatchObject({ boarding: null, departPlanned: null });
    expect(delayMin({ planned: 150, actual: 158 })).toBe(8);
    expect(delayMin({ planned: 150, actual: null })).toBeNull();
  });
});
