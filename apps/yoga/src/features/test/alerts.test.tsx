// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { Alert, AlertCode, GameEvent } from "@yoga-auto/protocol";
import { getAlertPresenter, getEventPresenter } from "../../core/registry.ts";
import { resetSettings, updateSettings } from "../../core/settings.ts";
import { ALERT_PRESENTERS, EVENT_PRESENTERS } from "../alerts/index.tsx";

afterEach(() => {
  cleanup();
  resetSettings();
});

/** Kompilator wymusza kompletność: dodanie kodu do protokołu bez wpisu tutaj = błąd typów. */
const ALL_CODES: Record<AlertCode, true> = {
  "fuel.low": true,
  "adblue.low": true,
  "air.low": true,
  "air.emergency": true,
  "oil.pressure": true,
  "water.temp": true,
  "battery.voltage": true,
  "damage.hit": true,
  "damage.high": true,
  "rest.soon": true,
  "rest.now": true,
  "rest.overdue": true,
  speeding: true,
  "job.late": true,
  "game.disconnected": true,
};
const codes = Object.keys(ALL_CODES) as AlertCode[];

const SAMPLE_DATA: Record<AlertCode, Alert["data"]> = {
  "fuel.low": { amount: 41, rangeKm: 94 },
  "adblue.low": { amount: 6 },
  "air.low": { pressure: 62 },
  "air.emergency": { pressure: 40 },
  "oil.pressure": { value: 8 },
  "water.temp": { temp: 105 },
  "battery.voltage": { voltage: 11.2 },
  "damage.hit": { part: "engine", delta: 0.04 },
  "damage.high": { part: "chassis", wear: 0.62 },
  "rest.soon": { minutes: 45 },
  "rest.now": { minutes: 10 },
  "rest.overdue": { minutes: -25 },
  speeding: { limit: 22.2, speed: 25.1 },
  "job.late": { overdueMin: 42 },
  "game.disconnected": { source: "pipe" },
};

const alert = (code: AlertCode, data?: Alert["data"]): Alert => ({
  id: code,
  code,
  level: "warning",
  since: 1,
  sticky: true,
  ...(data ? { data } : {}),
});

describe("presentery alertów", () => {
  it("zarejestrowano prezenter dla każdego kodu", () => {
    for (const code of codes) expect(getAlertPresenter(code), code).toBeDefined();
    expect(Object.keys(ALERT_PRESENTERS).sort()).toEqual([...codes].sort());
  });

  it.each(codes)("%s: tytuł, treść, ikona i poziom z danymi oraz bez danych", (code) => {
    for (const data of [SAMPLE_DATA[code], undefined, {}]) {
      const c = ALERT_PRESENTERS[code](alert(code, data));
      expect(typeof c.title).toBe("string");
      expect((c.title as string).length).toBeGreaterThan(3);
      expect(c.icon).toBeTruthy();
      expect(["info", "warning", "critical"]).toContain(c.level);
      const { container } = render(
        <div>
          {c.icon}
          {c.title}
          {c.body}
        </div>,
      );
      expect(container.textContent).toContain(c.title as string);
      cleanup();
    }
  });

  it("air.emergency jest zawsze krytyczny, niezależnie od poziomu z bridge'a", () => {
    expect(ALERT_PRESENTERS["air.emergency"]({ ...alert("air.emergency"), level: "warning" }).level).toBe("critical");
  });

  it("treść respektuje jednostki z ustawień", () => {
    updateSettings({ units: { speed: "mph", temp: "f", volume: "gal" } });
    expect(ALERT_PRESENTERS.speeding(alert("speeding", SAMPLE_DATA.speeding)).body).toBe("56 / limit 50 mph");
    expect(ALERT_PRESENTERS["water.temp"](alert("water.temp", SAMPLE_DATA["water.temp"])).body).toContain("221°F");
    expect(ALERT_PRESENTERS["fuel.low"](alert("fuel.low", SAMPLE_DATA["fuel.low"])).body).toContain("58 mi");
    resetSettings();
    expect(ALERT_PRESENTERS.speeding(alert("speeding", SAMPLE_DATA.speeding)).body).toBe("90 / limit 80 km/h");
  });
});

describe("presentery zdarzeń", () => {
  it("job.delivered: podsumowanie z kwotą, dystansem i uszkodzeniami", () => {
    const e: Extract<GameEvent, { kind: "job.delivered" }> = {
      kind: "job.delivered",
      revenue: 18450,
      earnedXp: 120,
      cargoDamage: 0.012,
      distanceKm: 812,
      deliveryTime: 1000,
      autoParked: false,
      autoLoaded: false,
    };
    const c = EVENT_PRESENTERS["job.delivered"]!(e)!;
    expect(c.title).toBe("Dostawa zrealizowana");
    expect(String(c.body)).toContain("€18 450");
    expect(String(c.body)).toContain("812 km");
    expect(String(c.body)).toContain("1,2%");
    expect(String(c.body)).toContain("+120 XP");
  });

  it("mandat, myto, prom, tankowanie mają toast; pauza/wznowienie bez toastu", () => {
    expect(getEventPresenter("player.fined")!({ kind: "player.fined", offence: "Przekroczenie prędkości", amount: 250 })).toMatchObject({ title: "Mandat" });
    expect(getEventPresenter("player.tollgate")!({ kind: "player.tollgate", amount: 12 })).toMatchObject({ title: "Bramka płatna" });
    expect(getEventPresenter("player.ferry")!({ kind: "player.ferry", source: "Calais", target: "Dover", amount: 180 })).toMatchObject({ title: "Prom" });
    expect(getEventPresenter("player.refuel")!({ kind: "player.refuel", amount: 200 })).toMatchObject({ title: "Zatankowano" });
    expect(getEventPresenter("game.paused")).toBeUndefined();
    expect(getEventPresenter("game.resumed")).toBeUndefined();
  });
});
