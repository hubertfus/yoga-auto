import { describe, expect, it } from "vitest";
import { emptyFullState, type FullState } from "@yoga-auto/protocol";
import { AlertEngine, type AlertDelta } from "../src/alerts.ts";

const KMH = 1 / 3.6;

/** Harness: czas w ms, stan do modyfikacji, `run(ms)` przesuwa zegar krokami po 250 ms. */
function harness() {
  const s: FullState = emptyFullState("mock");
  s.status.connected = true;
  s.slow.fuel = { amount: 500, rangeKm: 1500, avgConsumption: 0.32, warning: false };
  s.slow.time.restStopMin = 400;
  s.slow.nav.speedLimit = 80 * KMH;
  s.fast.engineOn = true;
  const e = new AlertEngine();
  let now = 100_000;
  const log: { t: number; d: AlertDelta }[] = [];
  const run = (ms: number) => {
    for (let t = 0; t < ms; t += 250) {
      now += 250;
      const d = e.update(s, now);
      if (d) log.push({ t: now, d });
    }
  };
  const ids = () => e.alerts.map((a) => a.id).sort();
  const raisedIds = () => log.flatMap((l) => l.d.raised.map((a) => a.id));
  const clearedIds = () => log.flatMap((l) => l.d.cleared);
  const get = (id: string) => e.alerts.find((a) => a.id === id);
  return { s, e, run, ids, log, raisedIds, clearedIds, get, now: () => now };
}

describe("AlertEngine", () => {
  it("spokojny stan: brak alertów", () => {
    const h = harness();
    h.run(10_000);
    expect(h.ids()).toEqual([]);
  });

  it("rozgrzewka po połączeniu: reguły wstrzymane 1.5 s", () => {
    const h = harness();
    h.s.slow.adblue.warning = true;
    h.run(1000);
    expect(h.ids()).toEqual([]);
    h.run(2000);
    expect(h.ids()).toEqual(["adblue.low"]);
  });

  it("fuel.low: flaga SDK albo zasięg < 100 km; histereza (znika dopiero > 130 km); debounce", () => {
    const h = harness();
    h.run(2000);
    h.s.slow.fuel.rangeKm = 90;
    h.run(250);
    expect(h.ids()).toEqual([]); // debounce 500 ms
    h.run(500);
    expect(h.ids()).toEqual(["fuel.low"]);
    expect(h.get("fuel.low")).toMatchObject({ level: "warning", sticky: true });
    h.s.slow.fuel.rangeKm = 110; // powyżej progu wejścia, poniżej wyjścia → wisi dalej
    h.run(5000);
    expect(h.ids()).toEqual(["fuel.low"]);
    h.s.slow.fuel.rangeKm = 140;
    h.run(3000);
    expect(h.ids()).toEqual([]);
    h.s.slow.fuel.rangeKm = 0; // brak danych zasięgu nie jest „pustym bakiem”
    h.s.slow.fuel.warning = false;
    h.run(3000);
    expect(h.ids()).toEqual([]);
    h.s.slow.fuel.warning = true;
    h.run(1000);
    expect(h.ids()).toEqual(["fuel.low"]);
  });

  it("powietrze: warning vs emergency (critical) wykluczają się", () => {
    const h = harness();
    h.run(2000);
    h.s.slow.air = { pressure: 60, warning: true, emergency: false };
    h.run(1000);
    expect(h.ids()).toEqual(["air.low"]);
    h.s.slow.air = { pressure: 30, warning: true, emergency: true };
    h.run(1500);
    expect(h.ids()).toEqual(["air.emergency"]);
    expect(h.get("air.emergency")?.level).toBe("critical");
    h.s.slow.air = { pressure: 120, warning: false, emergency: false };
    h.run(2500);
    expect(h.ids()).toEqual([]);
  });

  it("flagi SDK: olej/woda/akumulator; olej i akumulator pomijane przy zgaszonym silniku", () => {
    const h = harness();
    h.run(2000);
    h.s.fast.engineOn = false;
    h.s.slow.oilPressure.warning = true;
    h.s.slow.battery.warning = true;
    h.s.slow.waterTempWarning = true;
    h.run(1500);
    expect(h.ids()).toEqual(["water.temp"]);
    h.s.fast.engineOn = true;
    h.run(1500);
    expect(h.ids()).toEqual(["battery.voltage", "oil.pressure", "water.temp"]);
  });

  it("odpoczynek: soon (info) → now (warning) → overdue (critical), jeden naraz, histereza", () => {
    const h = harness();
    h.run(2000);
    h.s.slow.time.restStopMin = 59;
    h.run(500);
    expect(h.ids()).toEqual(["rest.soon"]);
    expect(h.get("rest.soon")?.level).toBe("info");
    h.s.slow.time.restStopMin = 14;
    h.run(500);
    expect(h.ids()).toEqual(["rest.now"]);
    expect(h.get("rest.now")?.level).toBe("warning");
    h.s.slow.time.restStopMin = 0;
    h.run(500);
    expect(h.ids()).toEqual(["rest.overdue"]);
    expect(h.get("rest.overdue")?.level).toBe("critical");
    h.s.slow.time.restStopMin = -20;
    h.run(500);
    expect(h.ids()).toEqual(["rest.overdue"]);
    // wypoczęty: zejście z progu z marginesem
    h.s.slow.time.restStopMin = 17; // < 15 + 5 → jeszcze „now”
    h.run(500);
    expect(h.ids()).toEqual(["rest.now"]);
    h.s.slow.time.restStopMin = 62; // < 60 + 5 → „soon”
    h.run(500);
    expect(h.ids()).toEqual(["rest.soon"]);
    h.s.slow.time.restStopMin = 66;
    h.run(500);
    expect(h.ids()).toEqual([]);
    h.s.slow.time.restStopMin = null;
    h.run(500);
    expect(h.ids()).toEqual([]);
  });

  it("speeding: > limit + 5 km/h przez 3 s; znika poniżej limit + 2 km/h; krótkie przekroczenie ignorowane", () => {
    const h = harness();
    h.run(2000);
    h.s.fast.speed = 86 * KMH;
    h.run(2500);
    expect(h.ids()).toEqual([]);
    h.run(1000);
    expect(h.ids()).toEqual(["speeding"]);
    const a = h.get("speeding")!;
    expect(a.sticky).toBe(true);
    expect(a.data).toMatchObject({ limit: 22.22 });
    h.s.fast.speed = 83 * KMH; // w paśmie histerezy (2..5 km/h ponad limitem)
    h.run(3000);
    expect(h.ids()).toEqual(["speeding"]);
    h.s.fast.speed = 81 * KMH;
    h.run(1500);
    expect(h.ids()).toEqual([]);
    // krótki skok
    h.s.fast.speed = 90 * KMH;
    h.run(1500);
    h.s.fast.speed = 70 * KMH;
    h.run(5000);
    expect(h.ids()).toEqual([]);
    // brak limitu (0) = brak alertu
    h.s.slow.nav.speedLimit = 0;
    h.s.fast.speed = 130 * KMH;
    h.run(5000);
    expect(h.ids()).toEqual([]);
  });

  it("speeding: aktualizacja danych przy zmianie limitu (bez zalewania)", () => {
    const h = harness();
    h.run(2000);
    h.s.fast.speed = 95 * KMH;
    h.run(4000);
    const before = h.raisedIds().filter((i) => i === "speeding").length;
    h.s.slow.nav.speedLimit = 70 * KMH;
    h.run(1500);
    const after = h.raisedIds().filter((i) => i === "speeding").length;
    expect(after).toBe(before + 1);
    expect(h.get("speeding")?.data).toMatchObject({ limit: 19.44 });
  });

  it("damage.hit: ≥ 2 pp w < 5 s → jednorazowy toast (sticky:false), wygasa; jedna kolizja = jeden alert", () => {
    const h = harness();
    h.run(2000);
    h.s.slow.wear.cabin += 0.06;
    h.s.slow.wear.chassis += 0.04;
    h.run(250);
    const hit = h.e.alerts.find((a) => a.code === "damage.hit")!;
    expect(hit).toMatchObject({ level: "info", sticky: false });
    expect(hit.data).toMatchObject({ part: "cabin", delta: 0.06 });
    expect(hit.id).toMatch(/^damage\.hit:\d+$/);
    h.run(9000); // kolizja się skończyła; TTL 8 s minął
    expect(h.raisedIds().filter((i) => i.startsWith("damage.hit"))).toHaveLength(1);
    expect(h.e.alerts.some((a) => a.code === "damage.hit")).toBe(false);
    expect(h.clearedIds()).toContain(hit.id);
  });

  it("damage.hit: powolne zużycie nie jest kolizją; naprawa (spadek) nie wywołuje alertu", () => {
    const h = harness();
    h.run(2000);
    for (let i = 0; i < 40; i++) {
      h.s.slow.wear.engine += 0.004; // 0.4 pp co sekundę = 2 pp / 5 s tuż poniżej progu na krok
      h.run(1500);
    }
    expect(h.raisedIds().filter((i) => i.startsWith("damage.hit"))).toHaveLength(0);
    h.s.slow.wear.engine = 0;
    h.run(2000);
    expect(h.raisedIds().filter((i) => i.startsWith("damage.hit"))).toHaveLength(0);
  });

  it("damage.hit: skok przy zmianie ciężarówki / w pauzie to nie kolizja", () => {
    const h = harness();
    h.s.config.truck = { id: "a" } as never;
    h.run(2000);
    h.s.config.truck = { id: "b" } as never;
    h.s.slow.wear.engine = 0.4;
    h.run(500);
    h.s.status.paused = true;
    h.run(500);
    h.s.slow.wear.cabin = 0.3;
    h.run(500);
    h.s.status.paused = false;
    h.run(1000);
    expect(h.raisedIds().filter((i) => i.startsWith("damage.hit"))).toHaveLength(0);
  });

  it("damage.high: > 50% (warning, trwały), histereza 45%", () => {
    const h = harness();
    h.s.slow.wear.engine = 0.2;
    h.run(2000);
    h.s.slow.wear.engine = 0.55;
    h.s.slow.wear.cabin = 0.51;
    h.run(1500);
    // skok 35 pp to też uderzenie — sprawdzamy tylko damage.high
    expect(h.get("damage.high")).toMatchObject({ level: "warning", sticky: true, data: { part: "engine" } });
    h.s.slow.wear.engine = 0.47;
    h.s.slow.wear.cabin = 0.47;
    h.run(4000);
    expect(h.get("damage.high")).toBeDefined(); // w paśmie histerezy
    h.s.slow.wear.engine = 0.4;
    h.s.slow.wear.cabin = 0.4;
    h.run(4000);
    expect(h.get("damage.high")).toBeUndefined();
  });

  it("job.late: termin przekroczony = warning; prognoza GPS poza terminem = info", () => {
    const h = harness();
    h.s.config.job = { deliveryTime: 10_000 } as never;
    h.s.slow.time.game = 9000;
    h.s.slow.nav = { distance: 100_000, time: 3600, speedLimit: 22 }; // +60 min → 9060 < 10000
    h.run(15_000);
    expect(h.get("job.late")).toBeUndefined();
    h.s.slow.nav.time = 3600 * 20; // +1200 min → 10200 > 10000: spóźnienie 200 min
    h.run(11_000);
    expect(h.get("job.late")).toMatchObject({ level: "info" });
    h.s.slow.time.game = 10_050;
    h.run(1000);
    expect(h.get("job.late")).toMatchObject({ level: "warning", data: { overdueMin: 50 } });
    h.s.config.job = null;
    h.run(11_000);
    expect(h.get("job.late")).toBeUndefined();
  });

  it("game.disconnected po 2 s bez źródła; po rozłączeniu znikają pozostałe alerty; po powrocie ustępuje", () => {
    const h = harness();
    h.s.slow.adblue.warning = true;
    h.run(3000);
    expect(h.ids()).toEqual(["adblue.low"]);
    h.s.status.connected = false;
    h.run(1000);
    expect(h.ids()).toEqual([]);
    h.run(2000);
    expect(h.ids()).toEqual(["game.disconnected"]);
    expect(h.get("game.disconnected")).toMatchObject({ level: "warning", sticky: true });
    h.s.status.connected = true;
    h.run(250);
    expect(h.ids()).toEqual([]);
  });

  it("delta: raised zawiera alerty, cleared id; brak zmian = null", () => {
    const h = harness();
    h.run(2000);
    h.s.slow.adblue.warning = true;
    h.run(1000);
    expect(h.log.at(-1)?.d.raised.map((a) => a.id)).toEqual(["adblue.low"]);
    expect(h.e.update(h.s, h.now() + 250)).toBeNull();
    h.s.slow.adblue.warning = false;
    h.run(2000);
    expect(h.clearedIds()).toContain("adblue.low");
  });
});
