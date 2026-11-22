import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { emptyFullState, type FullState } from "@yoga-auto/protocol";
import { FileTripStorage, MemoryTripStorage, TripComputer } from "../src/trip.ts";

function drive(opts: { odo?: number; fuel?: number } = {}) {
  const s: FullState = emptyFullState("mock");
  s.status.connected = true;
  s.slow.odometer = opts.odo ?? 184_000;
  s.slow.fuel.amount = opts.fuel ?? 600;
  const storage = new MemoryTripStorage();
  let now = 1_000_000;
  const tc = new TripComputer(storage, () => now);
  /** jedź `sec` s z prędkością `v` m/s i spalaniem `lPer100` l/100 km, krok 0.25 s */
  const go = (sec: number, v: number, lPer100 = 32) => {
    for (let t = 0; t < sec; t += 0.25) {
      now += 250;
      const dist = v * 0.25;
      s.slow.odometer += dist / 1000;
      s.slow.fuel.amount -= (dist / 100_000) * lPer100;
      s.fast.speed = v;
      tc.update(s, now);
    }
  };
  return { s, tc, storage, go, now: () => now, tick: (ms: number) => (now += ms) };
}

describe("TripComputer", () => {
  it("dystans z odometru, paliwo z różnicy, czas jazdy, spalanie chwilowe", () => {
    const d = drive();
    d.tc.update(d.s, d.now()); // baza
    d.go(60, 22.22); // 60 s po 80 km/h
    const t = d.tc.state;
    expect(t.distance).toBeGreaterThan(1300);
    expect(t.distance).toBeLessThan(1340);
    expect(t.fuelUsed).toBeCloseTo((t.distance / 100_000) * 32, 1);
    expect(t.driveTime).toBeGreaterThan(58);
    expect(t.instantConsumption).toBeCloseTo(32, 0);
  });

  it("postój nie liczy się do czasu jazdy; spalanie chwilowe null bez dystansu", () => {
    const d = drive();
    d.tc.update(d.s, d.now());
    d.go(30, 0);
    expect(d.tc.state.driveTime).toBe(0);
    expect(d.tc.state.instantConsumption).toBeNull();
  });

  it("tankowanie (wzrost paliwa) nie zmniejsza zużycia", () => {
    const d = drive({ fuel: 100 });
    d.tc.update(d.s, d.now());
    d.go(30, 22.22);
    const used = d.tc.state.fuelUsed;
    d.s.slow.fuel.amount = 900; // stacja
    d.go(0.25, 0);
    expect(d.tc.state.fuelUsed).toBeCloseTo(used, 5);
    d.go(30, 22.22);
    expect(d.tc.state.fuelUsed).toBeGreaterThan(used);
  });

  it("skok odometru (wczytanie zapisu, inny pojazd) nie dolicza dystansu", () => {
    const d = drive();
    d.tc.update(d.s, d.now());
    d.go(10, 22.22);
    const before = d.tc.state.distance;
    d.s.slow.odometer = 5_000;
    d.go(0.25, 0);
    d.s.slow.odometer = 900_000;
    d.go(0.25, 0);
    expect(d.tc.state.distance).toBeCloseTo(before, 3);
  });

  it("pauza i rozłączenie nie liczą czasu ani dystansu", () => {
    const d = drive();
    d.tc.update(d.s, d.now());
    d.go(10, 22.22);
    const before = { ...d.tc.state };
    d.s.status.paused = true;
    d.tick(60_000);
    d.tc.update(d.s, d.now());
    d.s.status.paused = false;
    d.go(0.25, 0);
    expect(d.tc.state.driveTime).toBeCloseTo(before.driveTime, 3);
    d.s.status.connected = false;
    d.tick(120_000);
    d.tc.update(d.s, d.now());
    d.s.status.connected = true;
    d.s.slow.odometer += 50; // gra działała bez nas / inny zapis
    d.go(0.25, 0);
    expect(d.tc.state.distance).toBeCloseTo(before.distance, 3);
  });

  it("reset: dopisuje zakończoną wycieczkę do trips.jsonl, zeruje stan i ustawia resetAt", () => {
    const d = drive();
    d.tc.update(d.s, d.now());
    d.go(60, 22.22);
    const dist = d.tc.state.distance;
    const fin = d.tc.reset(d.now());
    expect(fin).toMatchObject({ kind: "trip", distance: Math.round(dist) });
    expect(fin!.avgSpeed).toBeCloseTo(22.22, 0);
    expect(fin!.avgConsumption).toBeCloseTo(32, 0);
    expect(d.storage.finished).toHaveLength(1);
    expect(d.tc.state).toMatchObject({ distance: 0, fuelUsed: 0, driveTime: 0, instantConsumption: null, resetAt: d.now() });
    expect(d.tc.reset(d.now())).toBeNull(); // pusta wycieczka nie trafia do historii
    expect(d.storage.finished).toHaveLength(1);
  });

  it("persist: bieżąca wycieczka przeżywa restart (plik), historia w jsonl", () => {
    const dir = mkdtempSync(join(tmpdir(), "yoga-trip-"));
    try {
      const storage = new FileTripStorage(dir);
      let now = 5_000_000;
      const s = emptyFullState("mock");
      s.status.connected = true;
      s.slow.odometer = 1000;
      s.slow.fuel.amount = 500;
      const a = new TripComputer(storage, () => now);
      a.update(s, now);
      for (let i = 0; i < 80; i++) {
        now += 250;
        s.slow.odometer += 0.005;
        s.slow.fuel.amount -= 0.01;
        s.fast.speed = 20;
        a.update(s, now);
      }
      a.flush();
      const dist = a.state.distance;
      const b = new TripComputer(new FileTripStorage(dir), () => now);
      expect(b.state.distance).toBeCloseTo(dist, 3);
      expect(b.state.resetAt).toBe(a.state.resetAt);
      b.reset(now);
      const lines = readFileSync(storage.historyFile, "utf8").trim().split("\n");
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0]!)).toMatchObject({ kind: "trip" });
      expect(new FileTripStorage(dir).readHistory()).toHaveLength(1);
      expect(new FileTripStorage(dir).loadCurrent()?.distance).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("uszkodzony plik bieżącej wycieczki → start od zera", () => {
    const dir = mkdtempSync(join(tmpdir(), "yoga-trip-"));
    try {
      expect(new FileTripStorage(dir).loadCurrent()).toBeNull();
      expect(new TripComputer(new FileTripStorage(dir), () => 42).state.resetAt).toBe(42);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
