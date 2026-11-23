// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { emptyFullState, type FastMsg, type FullState, type SnapshotMsg } from "@yoga-auto/protocol";
import { getScreens } from "../../core/registry.ts";
import { resetSettings, updateSettings } from "../../core/settings.ts";
import { store } from "../../core/store.ts";
import { TELLTALES } from "./Telltales.tsx";
import { reloadDriveLayout, updateDriveLayout } from "./layout.ts";
import "./index.tsx";

const snapshot = (state: FullState): SnapshotMsg => ({ t: "snapshot", seq: 1, ts: 1, state });
const fastMsg = (d: FastMsg["d"], seq: number): FastMsg => ({ t: "fast", seq, frame: seq, ts: seq, d });
const raf = () => new Promise((r) => setTimeout(r, 40));
const Drive = () => {
  const S = getScreens().find((s) => s.id === "drive")!.component;
  return <S />;
};

beforeEach(() => {
  store.reset();
  resetSettings();
  localStorage.clear();
  reloadDriveLayout();
});
afterEach(() => cleanup());

describe("ekran Jazda", () => {
  it("prędkość, bieg i przekroczenie limitu", async () => {
    const s = emptyFullState();
    s.slow.nav.speedLimit = 80 / 3.6;
    store.apply(snapshot(s));
    render(<Drive />);
    act(() => store.apply(fastMsg({ speed: 70 / 3.6, rpm: 1300, gear: 10 }, 2)));
    await act(raf);
    expect(screen.getByTestId("drive-speed").textContent).toBe("70");
    expect(screen.getByTestId("drive-gear").textContent).toBe("10");
    expect(screen.getByTestId("drive-speedo").dataset.over).toBe("false");
    act(() => store.apply(fastMsg({ speed: 90 / 3.6 }, 3)));
    await act(raf);
    expect(screen.getByTestId("drive-speed").textContent).toBe("90");
    expect(screen.getByTestId("drive-speedo").dataset.over).toBe("true");
  });

  it("kontrolki: zgaszone bez danych, zapalone wg stanu (ręczny, drogowe, rezerwa)", async () => {
    const s = emptyFullState();
    s.fast.parkingBrake = true;
    s.fast.lights.high = true;
    s.slow.fuel.warning = true;
    store.apply(snapshot(s));
    render(<Drive />);
    expect(screen.getAllByTestId(/^tt-/)).toHaveLength(TELLTALES.length);
    expect(screen.getByTestId("tt-parking-brake").dataset.on).toBe("true");
    expect(screen.getByTestId("tt-high").dataset.on).toBe("true");
    expect(screen.getByTestId("tt-fuel").dataset.on).toBe("true");
    expect(screen.getByTestId("tt-beacon").dataset.on).toBeUndefined();
    act(() => store.apply(fastMsg({ parkingBrake: false }, 2)));
    await act(raf);
    expect(screen.getByTestId("tt-parking-brake").dataset.on).toBeUndefined();
  });

  it("powietrze w barach (metryczne) i psi (imperialne), alarm na czerwono", () => {
    const s = emptyFullState();
    s.slow.air = { pressure: 120, warning: false, emergency: false };
    store.apply(snapshot(s));
    render(<Drive />);
    expect(screen.getByTestId("drive-air").textContent).toContain("8,3 bar");
    cleanup();
    updateSettings({ units: { speed: "mph" } });
    act(() => store.apply(snapshot({ ...s, slow: { ...s.slow, air: { pressure: 30, warning: true, emergency: true } } })));
    render(<Drive />);
    expect(screen.getByTestId("drive-air").textContent).toContain("30 psi");
    expect(screen.getByTestId("drive-air").dataset.tone).toBe("crit");
  });

  it("układ: domyślnie bez przycisków na dole; wybrane elementy znikają, dodane akcje się pojawiają", () => {
    store.apply(snapshot(emptyFullState()));
    render(<Drive />);
    expect(screen.queryByTestId("drive-actions")).toBeNull();
    expect(screen.getByTestId("drive-telltales")).toBeTruthy();
    expect(screen.getByTestId("drive-mfd")).toBeTruthy();
    act(() => updateDriveLayout({ telltales: false, panel: false, gauges: ["fuel"], actions: ["lights.hazard", "retarder.up"] }));
    expect(screen.queryByTestId("drive-telltales")).toBeNull();
    expect(screen.queryByTestId("drive-mfd")).toBeNull();
    expect(screen.getByTestId("drive-fuel")).toBeTruthy();
    expect(screen.queryByTestId("drive-air")).toBeNull();
    const actions = screen.getByTestId("drive-actions").querySelectorAll("[data-action]");
    expect([...actions].map((a) => a.getAttribute("data-action"))).toEqual(["lights.hazard", "retarder.up"]);
  });

  it("skala prędkościomierza z układu (0–100)", () => {
    store.apply(snapshot(emptyFullState()));
    updateDriveLayout({ speedRange: "low" });
    render(<Drive />);
    expect(screen.getByTestId("drive-speedo").getAttribute("aria-valuemax")).toBe("100");
  });
});
