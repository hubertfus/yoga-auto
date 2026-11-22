import { describe, expect, it } from "vitest";
import { DEFAULT_NIGHT_WINDOW as W, inWindow, minuteOfDay, nextNight, resolveAppearance } from "../daynight.ts";

const at = (h: number, m = 0) => h * 60 + m;

describe("minuteOfDay", () => {
  it("zawija po dobie i obsługuje śmieci", () => {
    expect(minuteOfDay(1440 * 5 + 75)).toBe(75);
    expect(minuteOfDay(-30)).toBe(1410);
    expect(minuteOfDay(null)).toBeNull();
    expect(minuteOfDay(NaN)).toBeNull();
  });
});

describe("inWindow", () => {
  it("okno przez północ", () => {
    expect(inWindow(at(23), at(20), at(6))).toBe(true);
    expect(inWindow(at(3), at(20), at(6))).toBe(true);
    expect(inWindow(at(12), at(20), at(6))).toBe(false);
    expect(inWindow(at(20), at(20), at(6))).toBe(true);
    expect(inWindow(at(6), at(20), at(6))).toBe(false);
  });
});

describe("nextNight (progi 20:00–6:00, histereza 20 min)", () => {
  it("dzień → noc o 20:00, nie wcześniej", () => {
    expect(nextNight(false, at(19, 59))).toBe(false);
    expect(nextNight(false, at(20))).toBe(true);
  });
  it("noc → dzień dopiero od 6:20", () => {
    expect(nextNight(true, at(6, 0))).toBe(true);
    expect(nextNight(true, at(6, 19))).toBe(true);
    expect(nextNight(true, at(6, 20))).toBe(false);
  });
  it("strefy histerezy (19:40–20:00, 6:00–6:20) utrzymują poprzedni stan", () => {
    expect(nextNight(true, at(19, 50))).toBe(true);
    expect(nextNight(false, at(19, 50))).toBe(false);
    expect(nextNight(false, at(6, 10))).toBe(false);
    expect(nextNight(true, at(6, 10))).toBe(true);
  });
  it("jitter wokół 20:00 zmienia stan dokładnie raz", () => {
    let n = false;
    const changes: boolean[] = [];
    for (const m of [1194, 1200, 1197, 1201, 1191, 1206]) {
      const nx = nextNight(n, m);
      if (nx !== n) changes.push(nx);
      n = nx;
    }
    expect(changes).toEqual([true]);
  });
  it("pełna doba po wielu dobach od startu świata: dokładnie dwie zmiany stanu", () => {
    let n = false;
    const changes: number[] = [];
    for (let m = 3 * 1440; m < 4 * 1440; m++) {
      const nx = nextNight(n, m);
      if (nx !== n) changes.push(m % 1440);
      n = nx;
    }
    // start doby: prev=false, a 0:00 jest w oknie nocy → noc; potem dzień o 6:20; noc o 20:00
    expect(changes).toEqual([0, at(6, 20), at(20)]);
  });
  it("brak danych czasu nie zmienia stanu", () => {
    expect(nextNight(true, null)).toBe(true);
    expect(nextNight(false, undefined)).toBe(false);
  });
  it("własne okno", () => {
    const w = { ...W, start: at(18), end: at(7), hysteresis: 0 };
    expect(nextNight(false, at(18), w)).toBe(true);
    expect(nextNight(true, at(7), w)).toBe(false);
  });
});

describe("resolveAppearance", () => {
  it("auto: noc → ciemny+noc, dzień → jasny", () => {
    expect(resolveAppearance({ theme: "auto", night: false }, true)).toEqual({ theme: "dark", night: true });
    expect(resolveAppearance({ theme: "auto", night: false }, false)).toEqual({ theme: "light", night: false });
  });
  it("ręczny motyw ignoruje czas gry; ręczny tryb nocny zostaje", () => {
    expect(resolveAppearance({ theme: "light", night: false }, true)).toEqual({ theme: "light", night: false });
    expect(resolveAppearance({ theme: "dark", night: true }, false)).toEqual({ theme: "dark", night: true });
    expect(resolveAppearance({ theme: "auto", night: true }, false)).toEqual({ theme: "light", night: true });
  });
});
