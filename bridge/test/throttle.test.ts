import { describe, expect, it } from "vitest";
import { emptyFullState, emptyLights, type FastState } from "@yoga-auto/protocol";
import { StateStore } from "../src/store.ts";
import { ClientStream, FAST_THRESHOLDS, SLOW_THRESHOLDS, changed, diffGroups } from "../src/throttle.ts";

describe("changed() z progami", () => {
  it("liczby poniżej progu nie są zmianą, powyżej są", () => {
    expect(changed(10, 10.04, "speed", FAST_THRESHOLDS)).toBe(false);
    expect(changed(10, 10.05, "speed", FAST_THRESHOLDS)).toBe(true);
    expect(changed(1200, 1209, "rpm", FAST_THRESHOLDS)).toBe(false);
    expect(changed(1200, 1210, "rpm", FAST_THRESHOLDS)).toBe(true);
    expect(changed(0.5, 0.505, "throttle", FAST_THRESHOLDS)).toBe(false);
    expect(changed(0.5, 0.51, "brake", FAST_THRESHOLDS)).toBe(true);
  });

  it("pola bez progu: każda zmiana", () => {
    expect(changed(3, 4, "gear", FAST_THRESHOLDS)).toBe(true);
    expect(changed(false, true, "hazard", FAST_THRESHOLDS)).toBe(true);
  });

  it("przejście na dokładne 0 zawsze wysyłane", () => {
    expect(changed(0.03, 0, "speed", FAST_THRESHOLDS)).toBe(true);
  });

  it("tolerancja na błąd zaokrągleń floatów", () => {
    expect(changed(184233.2, 184233.3, "fuel.amount", SLOW_THRESHOLDS)).toBe(true);
  });

  it("zagnieżdżone obiekty i tablice (trailers.*)", () => {
    const a = { fuel: { amount: 100, rangeKm: 300, avgConsumption: 0.3, warning: false } };
    expect(changed(a.fuel, { ...a.fuel, amount: 100.05 }, "fuel", SLOW_THRESHOLDS)).toBe(false);
    expect(changed(a.fuel, { ...a.fuel, amount: 100.1 }, "fuel", SLOW_THRESHOLDS)).toBe(true);
    expect(changed(a.fuel, { ...a.fuel, warning: true }, "fuel", SLOW_THRESHOLDS)).toBe(true);
    const tr = [{ connected: true, cargoDamage: 0.01, wear: { chassis: 0.02, wheels: 0, body: 0 } }];
    const tr2 = [{ ...tr[0]!, wear: { ...tr[0]!.wear, chassis: 0.0205 } }];
    const tr3 = [{ ...tr[0]!, wear: { ...tr[0]!.wear, chassis: 0.021 } }];
    expect(changed(tr, tr2, "trailers", SLOW_THRESHOLDS)).toBe(false);
    expect(changed(tr, tr3, "trailers", SLOW_THRESHOLDS)).toBe(true);
    expect(changed(tr, [], "trailers", SLOW_THRESHOLDS)).toBe(true);
  });

  it("temperatury 0.5 °C, wear 0.001", () => {
    const t = { oil: 85, water: 82, brake: 40 };
    expect(changed(t, { ...t, oil: 85.4 }, "temps", SLOW_THRESHOLDS)).toBe(false);
    expect(changed(t, { ...t, oil: 85.5 }, "temps", SLOW_THRESHOLDS)).toBe(true);
    const w = { engine: 0.02, transmission: 0, cabin: 0, chassis: 0, wheels: 0 };
    expect(changed(w, { ...w, engine: 0.0205 }, "wear", SLOW_THRESHOLDS)).toBe(false);
    expect(changed(w, { ...w, engine: 0.021 }, "wear", SLOW_THRESHOLDS)).toBe(true);
  });

  it("diffGroups zwraca tylko zmienione grupy (płytko, cała grupa)", () => {
    const s = emptyFullState().fast;
    const next: FastState = { ...s, speed: 1, lights: { ...s.lights, high: true } };
    const d = diffGroups(s, next, FAST_THRESHOLDS)!;
    expect(Object.keys(d).sort()).toEqual(["lights", "speed"]);
    expect(d.lights).toEqual({ ...emptyLights(), high: true });
  });
});

/** Symulacja: zmiany stanu co klatkę gry (60 fps), klienci z różnym fastHz. */
function simulate(hzs: number[], frames: number, mutate: (store: StateStore, frame: number) => void) {
  const store = new StateStore("mock");
  store.setStatus({ connected: true });
  const clients = hzs.map((hz) => {
    const stream = new ClientStream(store.state, { fastHz: hz });
    const view = structuredClone(store.state.fast);
    const seqs: number[] = [stream.synced(store.state)];
    return { stream, view, seqs, frames: 0 };
  });
  for (let f = 0; f < frames; f++) {
    const now = f * (1000 / 60);
    mutate(store, f);
    for (const c of clients) {
      const d = c.stream.takeFast(store.state.fast, now);
      if (!d) continue;
      c.seqs.push(c.stream.nextSeq());
      c.frames++;
      Object.assign(c.view, d);
    }
  }
  return { store, clients };
}

describe("ClientStream (throttler per klient)", () => {
  it("klienci 15/30/60 Hz nie gubią krótkich zmian (błąd F0: wspólny zbiór dirty)", () => {
    const { store, clients } = simulate([15, 30, 60], 120, (st, f) => {
      st.setFast("speed", 20 + f * 0.1);
      // pojedyncza zmiana w klatce, która nie wypada w slocie klienta 15 Hz
      if (f === 5) st.setFast("lights", { ...emptyLights(), low: true, parking: true });
      if (f === 61) st.setFast("hazard", true);
    });
    for (const c of clients) {
      expect(c.view.lights.low).toBe(true);
      expect(c.view.hazard).toBe(true);
      expect(Math.abs(c.view.speed - store.state.fast.speed)).toBeLessThan(0.05 * 20);
    }
  });

  it("częstotliwość ramek odpowiada fastHz", () => {
    const { clients } = simulate([15, 30, 60], 600, (st, f) => st.setFast("rpm", 1000 + f * 20));
    // 10 s symulacji
    expect(clients[0]!.frames).toBeGreaterThanOrEqual(140);
    expect(clients[0]!.frames).toBeLessThanOrEqual(160);
    expect(clients[1]!.frames).toBeGreaterThanOrEqual(290);
    expect(clients[1]!.frames).toBeLessThanOrEqual(310);
    expect(clients[2]!.frames).toBeGreaterThanOrEqual(580);
  });

  it("seq ciągły per klient, snapshot niesie ostatni użyty seq", () => {
    const { clients } = simulate([15, 60], 100, (st, f) => st.setFast("rpm", 1000 + f * 20));
    for (const c of clients) {
      expect(c.seqs[0]).toBe(0);
      c.seqs.forEach((s, i) => expect(s).toBe(i));
      expect(c.stream.synced(emptyFullState())).toBe(c.seqs.at(-1));
    }
  });

  it("brak istotnej zmiany = brak ramki", () => {
    const { clients } = simulate([30], 120, (st, f) => st.setFast("speed", 20 + (f % 2) * 0.01));
    expect(clients[0]!.frames).toBeLessThanOrEqual(1);
  });

  it("zmiany poniżej progu kumulują się względem ostatnio WYSŁANEJ wartości", () => {
    const { clients, store } = simulate([30], 60, (st, f) => st.setFast("speed", 20 + f * 0.004));
    // 0.004/klatkę < próg, ale łącznie 0.24 m/s → klient dostał kilka ramek i jest blisko prawdy
    expect(clients[0]!.frames).toBeGreaterThanOrEqual(3);
    expect(Math.abs(clients[0]!.view.speed - store.state.fast.speed)).toBeLessThan(0.05);
  });

  it("placement: tylko po subskrypcji i maks. 10 Hz", () => {
    const store = new StateStore("mock");
    const s = new ClientStream(store.state, { fastHz: 60 });
    let withPlacement = 0;
    let frames = 0;
    for (let f = 0; f < 120; f++) {
      if (f === 60) s.placement = true;
      store.setFast("placement", { x: f, y: 0, z: f, heading: 0.1 });
      store.setFast("rpm", 1000 + f * 20);
      const d = s.takeFast(store.state.fast, f * (1000 / 60));
      if (!d) continue;
      frames++;
      if (d.placement) {
        withPlacement++;
        expect(f).toBeGreaterThanOrEqual(60);
      }
    }
    expect(frames).toBeGreaterThan(100);
    expect(withPlacement).toBeGreaterThanOrEqual(9);
    expect(withPlacement).toBeLessThanOrEqual(11);
  });

  it("slow: delta tylko dla istotnie zmienionych grup", () => {
    const store = new StateStore("mock");
    const s = new ClientStream(store.state, { fastHz: 30 });
    store.setSlow("fuel", { amount: 500, rangeKm: 1500, avgConsumption: 0.32, warning: false });
    expect(Object.keys(s.takeSlow(store.state.slow)!)).toEqual(["fuel"]);
    store.setSlow("fuel", { amount: 499.95, rangeKm: 1500, avgConsumption: 0.32, warning: false });
    expect(s.takeSlow(store.state.slow)).toBeNull();
    store.setSlow("fuel", { amount: 499.9, rangeKm: 1500, avgConsumption: 0.32, warning: false });
    expect(s.takeSlow(store.state.slow)?.fuel?.amount).toBe(499.9);
  });
});
