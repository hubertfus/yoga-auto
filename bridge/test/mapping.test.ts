import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { emptyFast, emptyLights, type FastState, type ipc } from "@yoga-auto/protocol";
import { RawChannels, applyConfig, applyTelemetry } from "../src/mapping.ts";
import { StateStore } from "../src/store.ts";

const fixture = <T>(p: string): T =>
  JSON.parse(readFileSync(resolve(import.meta.dirname, "../../shared/protocol/fixtures", p), "utf8")) as T;

function mapped(ch: Record<string, ipc.IpcValue>) {
  const store = new StateStore("pipe");
  const raw = new RawChannels();
  raw.merge(ch);
  applyTelemetry(store, raw);
  return store.state;
}

describe("mapping", () => {
  it("fixture ipc/tel.json → oczekiwany FastState", () => {
    const tel = fixture<ipc.IpcTelemetry>("ipc/tel.json");
    const expected: FastState = {
      ...emptyFast(),
      speed: 23.61,
      rpm: 1180,
      lights: { ...emptyLights(), low: true },
      placement: { x: -9123.4, y: 52.1, z: 14022.8, heading: 0.25 },
    };
    expect(mapped(tel.ch).fast).toEqual(expected);
  });

  it("fixture ws/fast.json jest zgodny z mapowaniem tych samych kanałów", () => {
    const ws = fixture<{ d: Partial<FastState> }>("ws/fast.json");
    const st = mapped({
      "truck.speed": 23.61,
      "truck.engine.rpm": 1180,
      "truck.displayed.gear": 12,
      "truck.light.parking": true,
      "truck.light.beam.low": true,
    });
    for (const [k, v] of Object.entries(ws.d)) expect(st.fast[k as keyof FastState]).toEqual(v);
  });

  it("aux u32 → off/dimmed/full, dźwignia kierunkowskazu, retarder", () => {
    const st = mapped({
      "truck.light.aux.front": 1,
      "truck.light.aux.roof": 2,
      "truck.rblinker": true,
      "truck.brake.retarder": 3,
    });
    expect(st.fast.lights.auxFront).toBe("dimmed");
    expect(st.fast.lights.auxRoof).toBe("full");
    expect(st.fast.blinker).toBe("right");
    expect(st.fast.retarder).toBe(3);
  });

  it("rest.stop → restStopMin, brak trasy → nav null", () => {
    const st = mapped({ "rest.stop": 42, "truck.navigation.distance": 0, "game.time": 3000 });
    expect(st.slow.time.restStopMin).toBe(42);
    expect(st.slow.time.game).toBe(3000);
    expect(st.slow.nav.distance).toBeNull();
    expect(st.slow.nav.time).toBeNull();
    expect(mapped({}).slow.time.restStopMin).toBeNull();
  });

  it("przyczepy z trailer.N.*", () => {
    const st = mapped({ "trailer.0.connected": true, "trailer.0.cargo.damage": 0.02, "trailer.0.wear.body": 0.1 });
    expect(st.slow.trailers).toEqual([{ connected: true, cargoDamage: 0.02, wear: { chassis: 0, wheels: 0, body: 0.1 } }]);
  });

  it("config job/truck/trailer.N", () => {
    const store = new StateStore("pipe");
    applyConfig(store, { t: "cfg", id: "truck", attrs: { brand: "Scania", "retarder.steps": 5, "license.plate": "" } });
    applyConfig(store, { t: "cfg", id: "trailer.1", attrs: { id: "t1", name: "Box" } });
    applyConfig(store, { t: "cfg", id: "job", attrs: { cargo: "Elektronika", "delivery.time": 0 } });
    expect(store.state.config.truck?.retarderSteps).toBe(5);
    expect(store.state.config.truck?.licensePlate).toBeNull();
    expect(store.state.config.trailers.map((t) => t.index)).toEqual([1]);
    expect(store.state.config.job?.deliveryTime).toBeNull();
    applyConfig(store, { t: "cfg", id: "trailer.1", attrs: null });
    applyConfig(store, { t: "cfg", id: "job", attrs: null });
    expect(store.state.config.trailers).toEqual([]);
    expect(store.state.config.job).toBeNull();
  });
});
