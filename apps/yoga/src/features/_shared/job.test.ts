import { describe, expect, it } from "vitest";
import type { JobConfig } from "@yoga-auto/protocol";
import { busSummary, isBusJob, passengersText, plural, stopsText } from "./job.ts";

const place = { city: "", cityId: "", company: "", companyId: "" };
const job = (bus: Partial<NonNullable<JobConfig["bus"]>> | null): JobConfig => ({
  ...(bus ? { kind: "bus" as const, bus: { passengers: null, capacity: null, stops: null, stages: [], current: 0, market: "", raw: {}, ...bus } } : {}),
  cargo: "",
  cargoId: "",
  mass: 0,
  income: 0,
  deliveryTime: null,
  plannedDistanceKm: 0,
  source: place,
  destination: place,
  market: "",
  special: false,
  cargoLoaded: true,
});

describe("teksty kursu autobusowego", () => {
  it("odmiana", () => {
    expect([1, 2, 4, 5, 12, 22, 25].map((n) => plural(n, "przystanek", "przystanki", "przystanków"))).toEqual([
      "przystanek",
      "przystanki",
      "przystanki",
      "przystanków",
      "przystanków",
      "przystanki",
      "przystanków",
    ]);
  });
  it("pasażerowie, miejsca, przystanki, podsumowanie", () => {
    expect(isBusJob(job(null))).toBe(false);
    expect(isBusJob(job({}))).toBe(true);
    expect(passengersText(job({ passengers: 32, capacity: 49 }))).toBe("32/49 pasażerów");
    expect(passengersText(job({ passengers: 1 }))).toBe("1 pasażer");
    expect(passengersText(job({ capacity: 49 }))).toBe("49 miejsc");
    expect(passengersText(job({}))).toBeNull();
    expect(stopsText(job({ stops: 3 }))).toBe("3 przystanki");
    expect(busSummary(job({ passengers: 32, capacity: 49, stops: 3 }))).toBe("Kurs autobusowy · 32/49 pasażerów · 3 przystanki");
    expect(busSummary(job({}))).toBe("Kurs autobusowy");
  });
});
