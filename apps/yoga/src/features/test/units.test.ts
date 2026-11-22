import { describe, expect, it } from "vitest";
import {
  formatArrival,
  formatConsumption,
  formatDistance,
  formatDuration,
  formatGameTime,
  formatKm,
  formatLimit,
  formatMass,
  formatMinutes,
  formatMoney,
  formatPercent,
  formatPressure,
  formatSpeed,
  formatTemp,
  formatVolume,
  speedLabel,
} from "../units/format.ts";

const metric = { speed: "kmh", temp: "c", volume: "l" } as const;
const imperial = { speed: "mph", temp: "f", volume: "gal" } as const;

describe("formatery jednostek", () => {
  it.each([
    [0, "0"],
    [10, "36"],
    [22.2222, "80"],
    [24.17, "87"],
    [-3, "11"], // cofanie bez znaku
    [null, "–"],
    [Number.NaN, "–"],
  ])("prędkość %s m/s → %s km/h", (ms, expected) => {
    expect(formatSpeed(ms, metric)).toBe(expected);
  });

  it.each([
    [22.2222, "50"],
    [38.89, "87"],
    [0, "0"],
  ])("prędkość %s m/s → %s mph", (ms, expected) => {
    expect(formatSpeed(ms, imperial)).toBe(expected);
  });

  it("etykieta prędkości", () => {
    expect(speedLabel(metric)).toBe("km/h");
    expect(speedLabel(imperial)).toBe("mph");
  });

  it.each([
    [0, "–"],
    [22.2222, "80"],
    [null, "–"],
  ])("limit %s m/s → %s", (ms, expected) => {
    expect(formatLimit(ms, metric)).toBe(expected);
  });

  it.each([
    [630, metric, "630"],
    [630.4, metric, "630"],
    [100, imperial, "26.4"],
    [null, metric, "–"],
  ])("objętość %s l", (l, u, expected) => {
    expect(formatVolume(l, u)).toBe(expected);
  });

  it.each([
    [0, metric, "0°C"],
    [88.4, metric, "88°C"],
    [0, imperial, "32°F"],
    [100, imperial, "212°F"],
    [-40, imperial, "-40°F"],
    [null, metric, "–"],
  ])("temperatura %s °C", (c, u, expected) => {
    expect(formatTemp(c, u)).toBe(expected);
  });

  it.each([
    [184_000, metric, "184 km"],
    [6_400, metric, "6,4 km"],
    [812_000, imperial, "505 mi"],
    [0, metric, "0,0 km"],
    [null, metric, "–"],
  ])("dystans %s m", (m, u, expected) => {
    expect(formatDistance(m, u)).toBe(expected);
  });

  it("km → tekst z jednostką", () => {
    expect(formatKm(1969, metric)).toBe("1969 km");
    expect(formatKm(null, metric)).toBe("–");
  });

  it.each([
    [7380, "2 h 03"],
    [3600, "1 h 00"],
    [29, "<1 min"],
    [59, "1 min"],
    [2700, "45 min"],
    [0, "<1 min"],
    [-720, "−12 min"],
    [-7380, "−2 h 03"],
    [null, "–"],
  ])("czas trwania %s s → %s", (s, expected) => {
    expect(formatDuration(s)).toBe(expected);
  });

  it("minuty → czas trwania", () => {
    expect(formatMinutes(190)).toBe("3 h 10");
    expect(formatMinutes(null)).toBe("–");
  });

  it.each([
    [0, "pn 00:00"],
    [1440 + 16 * 60, "wt 16:00"],
    [2 * 1440 + 8 * 60 + 17, "śr 08:17"],
    [6 * 1440 + 23 * 60 + 59, "nd 23:59"],
    [7 * 1440 + 5, "pn 00:05"],
    [null, "–"],
  ])("czas gry %s min → %s", (min, expected) => {
    expect(formatGameTime(min)).toBe(expected);
  });

  it("godzina przyjazdu = czas gry + ETA", () => {
    expect(formatArrival(14 * 60 + 32, 2 * 3600 + 3 * 60)).toBe("16:35");
    expect(formatArrival(23 * 60 + 30, 3600)).toBe("00:30");
    expect(formatArrival(null, 100)).toBe("–");
  });

  it("zużycie paliwa", () => {
    expect(formatConsumption(32.5, metric)).toBe("32.5 l/100 km");
    expect(formatConsumption(32.5, imperial)).toBe("7.2 mpg");
    expect(formatConsumption(null, metric)).toBe("–");
    expect(formatConsumption(0, metric)).toBe("–");
  });

  it("pieniądze, procenty, masa, ciśnienie", () => {
    expect(formatMoney(18450)).toBe("€18 450");
    expect(formatMoney(-500)).toBe("−€500");
    expect(formatMoney(null)).toBe("–");
    expect(formatPercent(0.634)).toBe("63%");
    expect(formatPercent(0.012, true)).toBe("1,2%");
    expect(formatMass(18000)).toBe("18 t");
    expect(formatMass(18500)).toBe("18,5 t");
    expect(formatMass(950)).toBe("950 kg");
    expect(formatPressure(118.4)).toBe("118 psi");
    expect(formatPressure(null)).toBe("–");
  });
});
