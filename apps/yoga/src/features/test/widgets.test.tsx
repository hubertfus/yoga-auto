// @vitest-environment jsdom
/** Widgety i ekrany: brak danych nie wywala renderu, szybkie liczby aktualizują się bez re-renderu, jednostki z ustawień. */
import { Profiler } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { emptyFullState, type FastMsg, type FullState, type SnapshotMsg } from "@yoga-auto/protocol";
import type { CardSize } from "@yoga-auto/glass-ui";
import { getScreens, getWidget, getWidgets } from "../../core/registry.ts";
import { resetSettings, updateSettings } from "../../core/settings.ts";
import { store } from "../../core/store.ts";
import "../alerts/index.tsx";
import "../drive/index.tsx";
import "../gauges/index.tsx";
import "../lights/index.tsx";
import "../navigation/index.tsx";
import "../radio/index.tsx";
import "../trip/index.tsx";
import "../vehicle/index.tsx";

const snapshot = (state: FullState): SnapshotMsg => ({ t: "snapshot", seq: 1, ts: 1, state });
const fastMsg = (d: FastMsg["d"], seq: number): FastMsg => ({ t: "fast", seq, frame: seq, ts: seq, d });
const w = (id: string, size?: CardSize) => {
  const def = getWidget(id)!;
  return <def.component size={size ?? def.size} />;
};
const raf = () => new Promise((r) => setTimeout(r, 40));

beforeEach(() => {
  store.reset();
  resetSettings();
});
afterEach(() => cleanup());

const EXPECTED_WIDGETS = ["speed", "rpm", "fuel", "nav", "job", "lights", "cruise", "rest", "status", "radio"];
const EXPECTED_SCREENS = ["drive", "vehicle", "nav", "trip"];

describe("rejestracja", () => {
  it("zarejestrowano wszystkie widgety i ekrany", () => {
    const widgets = getWidgets().map((w) => w.id);
    for (const id of EXPECTED_WIDGETS) expect(widgets, id).toContain(id);
    const screens = getScreens().map((s) => s.id);
    for (const id of EXPECTED_SCREENS) expect(screens, id).toContain(id);
  });
});

describe("brak danych", () => {
  it.each(EXPECTED_WIDGETS)("widget %s renderuje się na pustym stanie", (id) => {
    const w = getWidget(id)!;
    expect(() => render(<w.component size={w.size} />)).not.toThrow();
  });

  it.each(EXPECTED_SCREENS)("ekran %s renderuje się na pustym stanie", (id) => {
    const S = getScreens().find((s) => s.id === id)!.component;
    expect(() => render(<S />)).not.toThrow();
  });

  it("widgety znoszą null w polach opcjonalnych (brak trasy, zlecenia, ciężarówki, odpoczynku)", () => {
    const s = emptyFullState();
    s.config.truck = null;
    s.config.job = null;
    s.slow.nav.distance = null;
    s.slow.nav.time = null;
    s.slow.time.restStopMin = null;
    s.slow.trailers = [];
    store.apply(snapshot(s));
    for (const id of EXPECTED_WIDGETS) {
      const w = getWidget(id)!;
      expect(() => render(<w.component size={w.size} />), id).not.toThrow();
      cleanup();
    }
    render(w("job", "1x1"));
    expect(screen.getByText("Brak zlecenia")).toBeTruthy();
  });
});

describe("dane i jednostki", () => {
  it("nav: dystans i ETA z `slow.nav` w km, godzina przyjazdu w czasie gry", () => {
    const s = emptyFullState();
    s.slow.nav.distance = 184_000;
    s.slow.nav.time = 2 * 3600 + 3 * 60;
    s.slow.time.game = 14 * 60 + 32;
    store.apply(snapshot(s));
    render(w("nav", "1x1"));
    expect(screen.getByTestId("nav-distance").textContent).toBe("184 km");
    expect(screen.getByTestId("nav-eta").textContent).toContain("ETA 2 h 03");
    expect(screen.getByTestId("nav-eta").textContent).toContain("16:35");
  });

  it("nav w mph pokazuje mile", () => {
    const s = emptyFullState();
    s.slow.nav.distance = 160_934;
    store.apply(snapshot(s));
    updateSettings({ units: { speed: "mph" } });
    render(w("nav", "1x1"));
    expect(screen.getByTestId("nav-distance").textContent).toBe("100 mi");
  });

  it("job: trasa, zarobek, termin ze stanem spóźnienia", () => {
    const s = emptyFullState();
    s.config.job = {
      cargo: "Elektronika",
      cargoId: "x",
      mass: 18000,
      income: 18450,
      deliveryTime: 1000,
      plannedDistanceKm: 812,
      source: { city: "Wrocław", cityId: "wroclaw", company: "Tradeaux", companyId: "t" },
      destination: { city: "Hamburg", cityId: "hamburg", company: "LKW", companyId: "l" },
      market: "cargo_market",
      special: false,
      cargoLoaded: true,
    };
    s.slow.time.game = 1000 - 463;
    store.apply(snapshot(s));
    render(w("job", "1x1"));
    expect(screen.getByText(/Wrocław/)).toBeTruthy();
    expect(screen.getByText(/Hamburg/)).toBeTruthy();
    expect(screen.getByText(/€18.450/)).toBeTruthy();
    expect(screen.getByTestId("job-left").textContent).toBe("7 h 43");
  });

  it("rest: ostrzega poniżej godziny i po przekroczeniu", () => {
    const s = emptyFullState();
    s.slow.time.restStopMin = 190;
    store.apply(snapshot(s));
    const { rerender } = render(w("rest", "1x1"));
    expect(screen.getByTestId("rest-value").textContent).toBe("3 h 10");
    s.slow.time.restStopMin = -15;
    act(() => store.apply(snapshot({ ...s, slow: { ...s.slow, time: { ...s.slow.time, restStopMin: -15 } } })));
    rerender(w("rest", "1x1"));
    expect(screen.getByTestId("rest-value").textContent).toBe("−15 min");
  });

  it("speed: wartość z kanału fast w km/h i w mph", async () => {
    store.apply(snapshot(emptyFullState()));
    const { container, unmount } = render(w("speed", "2x1"));
    act(() => store.apply(fastMsg({ speed: 25 }, 2)));
    await act(raf);
    expect(container.querySelector(".lg-numeric")!.textContent).toBe("90");
    unmount();
    updateSettings({ units: { speed: "mph" } });
    const second = render(w("speed", "2x1"));
    await act(raf);
    expect(second.container.querySelector(".lg-numeric")!.textContent).toBe("56");
  });
});

describe("wydajność: szybkie liczby bez re-renderów", () => {
  it("zmiany fast.speed/rpm nie re-renderują widgetów, a liczby się zmieniają", async () => {
    store.apply(snapshot(emptyFullState()));
    const commits = vi.fn();
    const speed = getWidget("speed")!;
    const rpm = getWidget("rpm")!;
    const { container } = render(
      <Profiler id="w" onRender={commits}>
        <speed.component size="2x1" />
        <rpm.component size="1x1" />
      </Profiler>,
    );
    await act(raf);
    const base = commits.mock.calls.length;
    for (let i = 0; i < 20; i++) {
      act(() => store.apply(fastMsg({ speed: 10 + i, rpm: 800 + i * 40 }, 3 + i)));
      await act(raf);
    }
    expect(commits.mock.calls.length).toBe(base);
    const numerics = [...container.querySelectorAll(".lg-numeric")].map((n) => n.textContent);
    expect(numerics).toContain(String(Math.round((10 + 19) * 3.6)));
    // RPM w środku zegara goni cel sprężyną — wystarczy, że ruszył z miejsca
    expect(Number(numerics.find((n) => n !== String(Math.round((10 + 19) * 3.6))))).toBeGreaterThan(800);
  });
});
