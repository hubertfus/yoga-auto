import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { FullState, ipc } from "@yoga-auto/protocol";
import { SdkDiscovery } from "../src/discovery.ts";
import { mapGameplayEvent } from "../src/events.ts";
import { JobHistory, MemoryJobStorage } from "../src/jobs.ts";
import { applyConfig, mapBusJob, onBoard, vehicleKindOf } from "../src/mapping.ts";
import { buildGraph } from "../src/route/graph.ts";
import { RouteService, cityCentersFrom } from "../src/route/service.ts";
import { StateStore } from "../src/store.ts";

const cfg = (id: string, attrs: ipc.IpcConfig["attrs"]): ipc.IpcConfig => ({ t: "cfg", id, attrs });

/** Prawdziwy `bus_job` z ETS2 1.62 (sdk-discovery.jsonl), po odjeździe z pierwszego przystanku. */
const REAL: NonNullable<ipc.IpcConfig["attrs"]> = {
  "bus.stages.count": 7,
  "bus.stages.current": 0,
  income: 53346,
  "planned_distance.km": 2980,
  "bus_job.market": "quick_job",
  "source_stop.type": ["city", "city", "city", "city", "city", "city", "city"],
  "source_stop.id": ["bratislava", "budapest", "debrecen", "cluj_napoca", "bucuresti", "burgas", "edirne"],
  "source_stop.name": ["Bratysława", "Budapeszt", "Debreczyn", "Kluż-Napoka", "Bukareszt", "Burgas", "Edirne"],
  "destination_stop.type": ["city", "city", "city", "city", "city", "city", "city"],
  "destination_stop.id": ["budapest", "debrecen", "cluj_napoca", "bucuresti", "burgas", "edirne", "durres"],
  "destination_stop.name": ["Budapeszt", "Debreczyn", "Kluż-Napoka", "Bukareszt", "Burgas", "Edirne", "Durrës"],
  "source_stop.departure_time.planned": [16644430, 16644680, 16644900, 16645315, 16645915, 16646330, 16646610],
  "source_stop.departure_time.actual": [16644430],
  "destination_stop.arrival_time.planned": [16644665, 16644885, 16645300, 16645900, 16646315, 16646595, 16647720],
  "source_stop.entering_passengers.planned": [25, 26, 38, 24, 34, 24, 36],
  "destination_stop.leaving_passengers.planned": [15, 22, 27, 34, 32, 20, 57],
};

describe("autobusy: rodzaj pojazdu", () => {
  it("modele autokarów → bus, ciężarówki → truck", () => {
    expect(vehicleKindOf({ id: "vehicle.man.lions_coach", name: "Lion's Coach" })).toBe("bus");
    expect(vehicleKindOf({ id: "vehicle.scania.touring", name: "Touring" })).toBe("bus");
    expect(vehicleKindOf({ id: "vehicle.volvo.9700", name: "9700" })).toBe("bus");
    expect(vehicleKindOf({ id: "vehicle.scania.s_2016", name: "S" })).toBe("truck");
    expect(vehicleKindOf({ id: "vehicle.volvo.fh16_2012", name: "FH16 2012" })).toBe("truck");
    expect(vehicleKindOf({ id: "vehicle.man.tgx_2020", name: "TGX" })).toBe("truck");
  });
});

describe("autobusy: bus_job (format gry 1.62)", () => {
  it("etapy, przystanki, godziny, pasażerowie; cel = cel bieżącego etapu", () => {
    const j = mapBusJob(REAL);
    expect(j.kind).toBe("bus");
    expect(j.income).toBe(53346);
    expect(j.plannedDistanceKm).toBe(2980);
    expect(j.market).toBe("quick_job");
    expect(j.source).toEqual({ city: "Bratysława", cityId: "bratislava", company: "", companyId: "" });
    expect(j.destination).toEqual({ city: "Budapeszt", cityId: "budapest", company: "", companyId: "" });
    expect(j.deliveryTime).toBe(16644665);
    const b = j.bus!;
    expect(b.stages).toHaveLength(7);
    expect(b.stops).toBe(8);
    expect(b.current).toBe(0);
    expect(b.stages[6]).toMatchObject({ from: { id: "edirne" }, to: { id: "durres", name: "Durrës", type: "city" } });
    expect(b.stages[0]).toMatchObject({ departPlanned: 16644430, departActual: 16644430, arriveActual: null, boardingPlanned: 25, alightingPlanned: 15 });
    expect(b.stages[1]!.departActual).toBeNull();
    expect(b.passengers).toBe(25); // odjechano z Bratysławy: 25 wsiadło
    expect(b.raw["source_stop.id"]).toBe(JSON.stringify(REAL["source_stop.id"]));
  });

  it("pasażerowie na pokładzie: przed odjazdem, po odjeździe, kolejne etapy, faktyczne liczby", () => {
    const st = mapBusJob(REAL).bus!.stages;
    const before = st.map((s, i) => (i === 0 ? { ...s, departActual: null } : s));
    expect(onBoard(before, 0)).toBeNull();
    expect(onBoard(st, 0)).toBe(25);
    // etap 1 przed odjazdem z Budapesztu: 25 − 15 wysiadło
    expect(onBoard(st, 1)).toBe(10);
    const after = st.map((s, i) => (i === 1 ? { ...s, departActual: 16644690, boardingActual: 30 } : s));
    expect(onBoard(after, 1)).toBe(40);
  });

  it("inny format (bez tablic): nazwy jak w job, szukanie po fragmentach", () => {
    const j = mapBusJob({ "start.city": "Praha", "target.city": "Brno", reward: 900, "max.passengers": 50, passengers: 12 });
    expect(j.source.city).toBe("Praha");
    expect(j.destination.city).toBe("Brno");
    expect(j.income).toBe(900);
    expect(j.bus).toMatchObject({ passengers: 12, capacity: 50, stages: [] });
  });

  it("kurs przesłania ładunek i zmienia pojazd na bus; pusty bus_job kończy kurs", () => {
    const store = new StateStore("pipe");
    applyConfig(store, cfg("truck", { id: "vehicle.scania.s_2016", name: "S", brand: "Scania" }));
    expect(store.state.config.truck!.kind).toBe("truck");
    applyConfig(store, cfg("job", null));
    applyConfig(store, cfg("bus_job", REAL));
    expect(store.state.config.job!.kind).toBe("bus");
    expect(store.state.config.truck!.kind).toBe("bus");
    applyConfig(store, cfg("bus_job", null));
    expect(store.state.config.job).toBeNull();
    expect(store.state.config.truck!.kind).toBe("truck");
  });

  it("autokar bez kursu to nadal bus; zlecenie z ładunkiem nie przesłania kursu", () => {
    const store = new StateStore("pipe");
    applyConfig(store, cfg("bus_job", REAL));
    applyConfig(store, cfg("truck", { id: "vehicle.man.lions_coach", name: "Lion's Coach" }));
    expect(store.state.config.truck!.kind).toBe("bus");
    applyConfig(store, cfg("job", { cargo: "Elektronika", "source.city": "Wrocław" }));
    expect(store.state.config.job!.kind).toBe("bus");
    applyConfig(store, cfg("bus_job", {}));
    expect(store.state.config.job!.cargo).toBe("Elektronika");
    expect(store.state.config.truck!.kind).toBe("bus"); // model autokaru
  });

  it("historia: kolejny etap to ten sam kurs (nie nowe zlecenie); zdarzenia bus_job.* z jobKind bus", () => {
    const h = new JobHistory(new MemoryJobStorage(), () => 1000);
    expect(h.onJob(mapBusJob(REAL))).toBe(true);
    expect(h.onJob(mapBusJob({ ...REAL, "bus.stages.current": 1 }))).toBe(false);
    const delivered = mapGameplayEvent({ t: "evt", id: "bus_job.delivered", attrs: { revenue: 53000, "distance.km": 2990 } });
    expect(delivered).toMatchObject({ kind: "job.delivered", jobKind: "bus", revenue: 53000, cargoDamage: 0 });
    expect(mapGameplayEvent({ t: "evt", id: "bus_job.cancelled", attrs: { "cancel.penalty": 300 } })).toEqual({
      kind: "job.cancelled",
      jobKind: "bus",
      penalty: 300,
    });
    expect(h.onEvent(delivered!)).toMatchObject({ kind: "bus", status: "delivered", revenue: 53000 });
  });
});

describe("autobusy: trasa do następnego przystanku", () => {
  it("cityCentersFrom czyta tokeny z route-places.json (stare pliki bez tokenów = pusto)", () => {
    const m = cityCentersFrom({ v: 1, cities: [["Budapest", 32368, 17863, "hungary", "budapest"], ["Old", 1, 2, "x"]] });
    expect([...m]).toEqual([["budapest", { x: 32368, z: 17863 }]]);
    expect(cityCentersFrom(null).size).toBe(0);
  });

  it("RouteService prowadzi do centrum miasta przystanku docelowego etapu", () => {
    // droga w linii prostej: 0 → 1 → 2 (co 500 m), dwukierunkowa
    const x = [0, 500, 1000];
    const z = [0, 0, 0];
    const edges: [number, number, number, number, number][] = [];
    for (let i = 0; i < 2; i++) {
      edges.push([i * 2, (i + 1) * 2, 500, 20, 2]);
      edges.push([(i + 1) * 2 + 1, i * 2 + 1, 500, 20, 2]);
    }
    const g = buildGraph({ x, z, rot: [0, 0, 0], edges });
    const logs: string[] = [];
    const svc = new RouteService(g, (_l, m) => logs.push(m), new Map([["budapest", { x: 1000, z: 0 }]]));
    const store = new StateStore("pipe");
    applyConfig(store, cfg("bus_job", REAL));
    const state: FullState = {
      ...store.state,
      fast: { ...store.state.fast, speed: 10, placement: { x: 0, z: 0, heading: 0.75 } as never },
    };
    const r = svc.update(state, 0);
    expect(r).toBeTruthy();
    expect(r!.to).toEqual({ city: "Budapeszt", company: "przystanek" });
    // miasto bez pozycji: bez trasy, ostrzeżenie raz
    applyConfig(store, cfg("bus_job", { ...REAL, "bus.stages.current": 1 }));
    expect(svc.update({ ...state, config: store.state.config }, 1000)).toBeNull();
    expect(logs.some((m) => m.includes("debrecen"))).toBe(true);
  });
});

describe("SdkDiscovery", () => {
  it("zapisuje nieznane konfiguracje/zdarzenia raz na kształt; znane pomija", () => {
    const file = join(mkdtempSync(join(tmpdir(), "yoga-disc-")), "sdk-discovery.jsonl");
    const logs: string[] = [];
    const d = new SdkDiscovery(file, (m) => logs.push(m));
    expect(d.record(cfg("job", { cargo: "x" }))).toBeNull();
    expect(d.record(cfg("truck", { id: "x" }))).toBeNull();
    expect(d.record(cfg("bus_job", REAL))).not.toBeNull();
    expect(d.record(cfg("bus_job", { ...REAL, income: 1 }))).toBeNull(); // ten sam kształt
    expect(d.record(cfg("bus_job", null))).not.toBeNull();
    expect(d.record({ t: "evt", id: "job.delivered", attrs: {} })).toBeNull();
    expect(d.record({ t: "evt", id: "bus_job.passenger.boarded", attrs: { count: 3 } })).not.toBeNull();
    const lines = readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l) as { id: string });
    expect(lines.map((l) => l.id)).toEqual(["bus_job", "bus_job", "bus_job.passenger.boarded"]);
    expect(logs).toHaveLength(3);
  });
});
