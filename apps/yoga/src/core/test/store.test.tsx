// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyFullState } from "@yoga-auto/protocol";
import { store, useConfig, useFast, useFastValue, useSlow, useStatus, useAlerts } from "../store.ts";
import { hello } from "./utils.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** rAF → synchronicznie sterowany z testu */
let frame: (() => void) | null = null;
beforeEach(() => {
  frame = null;
  vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
    frame = cb;
    return 1;
  });
  store.reset();
  flushFrame();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function flushFrame() {
  act(() => {
    const f = frame;
    frame = null;
    f?.();
  });
}

describe("store.apply", () => {
  it("merge delty jest płytki na poziomie grupy", () => {
    store.apply({ t: "fast", seq: 1, ts: 0, frame: 1, d: { speed: 10, hazard: true } });
    store.apply({ t: "fast", seq: 2, ts: 0, frame: 2, d: { speed: 12 } });
    expect(store.state.fast.speed).toBe(12);
    expect(store.state.fast.hazard).toBe(true);
  });

  it("alerts: raised dodaje/aktualizuje, cleared usuwa", () => {
    const a = { id: "a", code: "fuel.low", level: "warning", since: 1, sticky: true } as const;
    const b = { id: "b", code: "speeding", level: "info", since: 2, sticky: true } as const;
    store.apply({ t: "alerts", ts: 0, raised: [a, b], cleared: [] });
    expect(store.state.alerts.map((x) => x.id)).toEqual(["a", "b"]);
    store.apply({ t: "alerts", ts: 0, raised: [{ ...a, level: "critical" }], cleared: ["b"] });
    expect(store.state.alerts).toHaveLength(1);
    expect(store.state.alerts[0]!.level).toBe("critical");
  });

  it("snapshot podmienia stan i seq", () => {
    const s = emptyFullState();
    s.fast.speed = 33;
    store.apply({ t: "snapshot", seq: 7, ts: 0, state: s });
    expect(store.state.fast.speed).toBe(33);
    expect(store.lastSeq).toBe(7);
  });

  it("zdarzenia trafiają do subskrybentów i nie ruszają listenerów stanu", () => {
    const onEvent = vi.fn();
    const onState = vi.fn();
    store.onEvent(onEvent);
    store.subscribe(onState);
    store.apply({ t: "event", ts: 0, event: { kind: "game.paused" } });
    expect(onEvent).toHaveBeenCalledWith({ kind: "game.paused" });
    expect(onState).not.toHaveBeenCalled();
  });

  it("nieznany `t` jest ignorowany", () => {
    const onState = vi.fn();
    store.subscribe(onState);
    store.apply({ t: "z-przyszlosci" } as never);
    expect(onState).not.toHaveBeenCalled();
  });
});

describe("useFastValue", () => {
  it("woła cb w rAF bez re-renderu komponentu", () => {
    let renders = 0;
    const cb = vi.fn();
    function C() {
      renders++;
      useFastValue((f) => f.speed, cb);
      return null;
    }
    render(<C />);
    expect(cb).toHaveBeenLastCalledWith(0);
    const r0 = renders;
    for (let i = 1; i <= 30; i++) {
      store.apply({ t: "fast", seq: i, ts: 0, frame: i, d: { speed: i } });
      flushFrame();
    }
    expect(cb).toHaveBeenLastCalledWith(30);
    expect(renders).toBe(r0);
  });

  it("zbija wiele ramek w jedno wywołanie na rAF", () => {
    const cb = vi.fn();
    function C() {
      useFastValue((f) => f.rpm, cb);
      return null;
    }
    render(<C />);
    cb.mockClear();
    for (let i = 1; i <= 5; i++) store.apply({ t: "fast", seq: i, ts: 0, frame: i, d: { rpm: 1000 + i } });
    flushFrame();
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(1005);
  });

  it("nie woła cb, gdy wybrana wartość się nie zmieniła", () => {
    const cb = vi.fn();
    function C() {
      useFastValue((f) => f.speed, cb);
      return null;
    }
    render(<C />);
    store.apply({ t: "fast", seq: 1, ts: 0, frame: 1, d: { rpm: 900 } });
    cb.mockClear();
    store.apply({ t: "fast", seq: 2, ts: 0, frame: 2, d: { rpm: 950 } });
    flushFrame();
    expect(cb).not.toHaveBeenCalled();
  });
});

describe("hooki z selektorem (useSyncExternalStore)", () => {
  it("useFast: brak re-renderu przy zmianie niesubskrybowanego pola", () => {
    let renders = 0;
    let seen: unknown;
    function C() {
      renders++;
      seen = useFast((f) => f.hazard);
      return null;
    }
    render(<C />);
    const r0 = renders;
    for (let i = 1; i <= 10; i++) {
      store.apply({ t: "fast", seq: i, ts: 0, frame: i, d: { speed: i, rpm: 800 + i } });
      flushFrame();
    }
    expect(renders).toBe(r0);
    store.apply({ t: "fast", seq: 11, ts: 0, frame: 11, d: { hazard: true } });
    flushFrame();
    expect(renders).toBe(r0 + 1);
    expect(seen).toBe(true);
  });

  it("useFast z selektorem obiektowym: porównanie płytkie", () => {
    let renders = 0;
    function C() {
      renders++;
      useFast((f) => ({ low: f.lights.low, high: f.lights.high }));
      return null;
    }
    render(<C />);
    const r0 = renders;
    // zmiana innego pola grupy lights → nowy obiekt lights, ale wybrane wartości te same
    store.apply({ t: "fast", seq: 1, ts: 0, frame: 1, d: { lights: { ...store.state.fast.lights, beacon: true } } });
    flushFrame();
    expect(renders).toBe(r0);
  });

  it("useSlow: re-render tylko przy zmianie wybranej wartości", () => {
    let renders = 0;
    function C() {
      renders++;
      useSlow((s) => s.fuel.warning);
      return null;
    }
    render(<C />);
    const r0 = renders;
    act(() => store.apply({ t: "slow", seq: 1, ts: 0, d: { odometer: 123 } }));
    expect(renders).toBe(r0);
    act(() => store.apply({ t: "slow", seq: 2, ts: 0, d: { fuel: { ...store.state.slow.fuel, warning: true } } }));
    expect(renders).toBe(r0 + 1);
  });

  it("useConfig / useStatus / useAlerts reagują na swoje wiadomości", () => {
    const out: Record<string, unknown> = {};
    function C() {
      out.job = useConfig((c) => c.job);
      out.connected = useStatus().connected;
      out.alerts = useAlerts().length;
      return null;
    }
    render(<C />);
    act(() => store.apply({ t: "status", seq: 1, ts: 0, status: { ...store.state.status, connected: true } }));
    expect(out.connected).toBe(true);
    act(() =>
      store.apply({
        t: "alerts",
        ts: 0,
        raised: [{ id: "x", code: "fuel.low", level: "info", since: 0, sticky: true }],
        cleared: [],
      }),
    );
    expect(out.alerts).toBe(1);
  });
});

describe("sesja", () => {
  it("hello z inną sesją czyści stan, z tą samą zostawia", () => {
    store.apply(hello("a"));
    store.apply({ t: "fast", seq: 1, ts: 0, frame: 1, d: { speed: 9 } });
    store.apply(hello("a"));
    expect(store.state.fast.speed).toBe(9);
    store.apply(hello("b"));
    expect(store.state.fast.speed).toBe(0);
  });
});
