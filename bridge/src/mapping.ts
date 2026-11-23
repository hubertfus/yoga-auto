/**
 * Surowe kanały/atrybuty SDK (IPC) → FastState / SlowState / ConfigState.
 * F0: mapowanie bazowe. S2: progi, eventy pochodne (job.started, trailer.attached), trip, alerty.
 */
import type { BusJobInfo, BusStage, BusStop, ConfigState, JobConfig, TrailerConfig, TrailerState, TruckConfig, VehicleKind, ipc } from "@yoga-auto/protocol";
import type { StateStore } from "./store.ts";

type V = ipc.IpcValue;
const num = (v: V | undefined, d = 0): number => (typeof v === "number" ? v : typeof v === "boolean" ? Number(v) : d);
const bool = (v: V | undefined): boolean => v === true || v === 1;
const str = (v: V | undefined): string => (typeof v === "string" ? v : "");
const aux = (v: V | undefined): "off" | "dimmed" | "full" => (num(v) === 2 ? "full" : num(v) === 1 ? "dimmed" : "off");

/** Pełny bieżący obraz surowych kanałów (tel przychodzi jako delty). */
export class RawChannels {
  readonly ch = new Map<string, V>();
  merge(delta: Record<string, V>): void {
    for (const [k, v] of Object.entries(delta)) this.ch.set(k, v);
  }
  get(name: string): V | undefined {
    return this.ch.get(name);
  }
}

export function applyTelemetry(store: StateStore, raw: RawChannels): void {
  const g = (n: string) => raw.get(n);
  store.setFast("speed", num(g("truck.speed")));
  store.setFast("rpm", num(g("truck.engine.rpm")));
  store.setFast("gear", num(g("truck.displayed.gear")));
  store.setFast("cruise", num(g("truck.cruise_control")));
  store.setFast("throttle", num(g("truck.effective.throttle")));
  store.setFast("brake", num(g("truck.effective.brake")));
  store.setFast("lights", {
    parking: bool(g("truck.light.parking")),
    low: bool(g("truck.light.beam.low")),
    high: bool(g("truck.light.beam.high")),
    beacon: bool(g("truck.light.beacon")),
    auxFront: aux(g("truck.light.aux.front")),
    auxRoof: aux(g("truck.light.aux.roof")),
    blinkerLeftOn: bool(g("truck.light.lblinker")),
    blinkerRightOn: bool(g("truck.light.rblinker")),
    brake: bool(g("truck.light.brake")),
    reverse: bool(g("truck.light.reverse")),
  });
  store.setFast("hazard", bool(g("truck.hazard.warning")));
  store.setFast("blinker", bool(g("truck.lblinker")) ? "left" : bool(g("truck.rblinker")) ? "right" : "off");
  store.setFast("parkingBrake", bool(g("truck.brake.parking")));
  store.setFast("motorBrake", bool(g("truck.brake.motor")));
  store.setFast("retarder", num(g("truck.brake.retarder")));
  store.setFast("engineOn", bool(g("truck.engine.enabled")));
  store.setFast("electricOn", bool(g("truck.electric.enabled")));
  const p = g("truck.world.placement");
  if (p && typeof p === "object" && "heading" in p)
    store.setFast("placement", { x: p.x, y: p.y, z: p.z, heading: p.heading });

  store.setSlow("fuel", {
    amount: num(g("truck.fuel.amount")),
    rangeKm: num(g("truck.fuel.range")),
    avgConsumption: num(g("truck.fuel.consumption.average")),
    warning: bool(g("truck.fuel.warning")),
  });
  store.setSlow("adblue", { amount: num(g("truck.adblue")), warning: bool(g("truck.adblue.warning")) });
  store.setSlow("air", {
    pressure: num(g("truck.brake.air.pressure")),
    warning: bool(g("truck.brake.air.pressure.warning")),
    emergency: bool(g("truck.brake.air.pressure.emergency")),
  });
  store.setSlow("temps", {
    oil: num(g("truck.oil.temperature")),
    water: num(g("truck.water.temperature")),
    brake: num(g("truck.brake.temperature")),
  });
  store.setSlow("oilPressure", { value: num(g("truck.oil.pressure")), warning: bool(g("truck.oil.pressure.warning")) });
  store.setSlow("waterTempWarning", bool(g("truck.water.temperature.warning")));
  store.setSlow("battery", {
    voltage: num(g("truck.battery.voltage")),
    warning: bool(g("truck.battery.voltage.warning")),
  });
  store.setSlow("wear", {
    engine: num(g("truck.wear.engine")),
    transmission: num(g("truck.wear.transmission")),
    cabin: num(g("truck.wear.cabin")),
    chassis: num(g("truck.wear.chassis")),
    wheels: num(g("truck.wear.wheels")),
  });
  const trailers: TrailerState[] = [];
  for (let i = 0; i < 10; i++) {
    const c = g(`trailer.${i}.connected`);
    if (c === undefined) continue;
    trailers[i] = {
      connected: bool(c),
      cargoDamage: num(g(`trailer.${i}.cargo.damage`)),
      wear: {
        chassis: num(g(`trailer.${i}.wear.chassis`)),
        wheels: num(g(`trailer.${i}.wear.wheels`)),
        body: num(g(`trailer.${i}.wear.body`)),
      },
    };
  }
  store.setSlow("trailers", trailers.filter(Boolean));
  const dist = num(g("truck.navigation.distance"));
  store.setSlow("nav", {
    distance: dist > 0 ? dist : null,
    time: dist > 0 ? num(g("truck.navigation.time")) : null,
    speedLimit: num(g("truck.navigation.speed.limit")),
  });
  const rest = g("rest.stop");
  store.setSlow("time", {
    game: num(g("game.time")),
    restStopMin: rest === undefined ? null : num(rest),
    scale: num(g("local.scale"), 1),
  });
  store.setSlow("odometer", num(g("truck.odometer")));
  store.setSlow("wipers", bool(g("truck.wipers")));
  store.setSlow("diffLock", bool(g("truck.differential_lock")));
  store.setSlow("liftAxle", bool(g("truck.lift_axle")));
  store.setSlow("trailerLiftAxle", bool(g("truck.trailer.lift_axle")));
}

/**
 * Zlecenie z ładunkiem (`job`) i kurs autobusowy (`bus_job`) przychodzą osobnymi konfiguracjami; w stanie jest
 * jedno `config.job` (kurs autobusowy ma pierwszeństwo). Model pojazdu pamiętamy, żeby po końcu kursu wrócić
 * do rodzaju wynikającego z modelu.
 */
interface JobSlots {
  cargo: JobConfig | null;
  bus: JobConfig | null;
  modelKind: VehicleKind;
}
const slots = new WeakMap<StateStore, JobSlots>();
function slotsOf(store: StateStore): JobSlots {
  let s = slots.get(store);
  if (!s) slots.set(store, (s = { cargo: null, bus: null, modelKind: "truck" }));
  return s;
}

/** Modele autokarów (ETS2: MAN, Scania, Volvo i mody); nazwy pojazdów ciężarowych tego nie zawierają. */
const BUS_MODEL = /coach|(^|[._\s-])bus($|[._\s-])|lion'?s|touring|irizar|setra|tourismo|travego|neoplan|intouro|tourliner|citaro|volvo[._\s-]?9[0-9]00/i;
export function vehicleKindOf(a: Record<string, V>): VehicleKind {
  return BUS_MODEL.test(`${str(a["id"])} ${str(a["name"])}`) ? "bus" : "truck";
}

function publishJob(store: StateStore, s: JobSlots): void {
  store.setConfig("job", s.bus ?? s.cargo);
  const t = store.state.config.truck;
  const kind: VehicleKind = s.bus ? "bus" : s.modelKind;
  if (t && t.kind !== kind) store.setConfig("truck", { ...t, kind });
}

export function applyConfig(store: StateStore, cfg: ipc.IpcConfig): void {
  const a = cfg.attrs as Record<string, V> | null;
  const s = slotsOf(store);
  if (cfg.id === "job") {
    s.cargo = a ? mapJob(a) : null;
    publishJob(store, s);
  } else if (cfg.id === "bus_job") {
    s.bus = a && Object.keys(a).length ? mapBusJob(cfg.attrs!) : null;
    publishJob(store, s);
  } else if (cfg.id === "truck") {
    s.modelKind = a ? vehicleKindOf(a) : "truck";
    store.setConfig("truck", a ? { ...mapTruck(a), kind: s.bus ? "bus" : s.modelKind } : null);
  } else if (cfg.id === "trailer" || cfg.id.startsWith("trailer.")) {
    const index = cfg.id === "trailer" ? 0 : Number(cfg.id.split(".")[1]);
    const list: ConfigState["trailers"] = store.state.config.trailers.filter((t) => t.index !== index);
    if (a) list.push(mapTrailer(index, a));
    list.sort((x, y) => x.index - y.index);
    store.setConfig("trailers", list);
  }
}

function mapJob(a: Record<string, V>): JobConfig {
  const dt = a["delivery.time"];
  return {
    cargo: str(a["cargo"]),
    cargoId: str(a["cargo.id"]),
    mass: num(a["cargo.mass"]),
    income: num(a["income"]),
    deliveryTime: typeof dt === "number" && dt > 0 ? dt : null,
    plannedDistanceKm: num(a["planned_distance.km"]),
    source: {
      city: str(a["source.city"]),
      cityId: str(a["source.city.id"]),
      company: str(a["source.company"]),
      companyId: str(a["source.company.id"]),
    },
    destination: {
      city: str(a["destination.city"]),
      cityId: str(a["destination.city.id"]),
      company: str(a["destination.company"]),
      companyId: str(a["destination.company.id"]),
    },
    market: str(a["job.market"]),
    special: bool(a["special.job"]),
    cargoLoaded: bool(a["is.cargo.loaded"]),
  };
}

/** Atrybut jako wartość prosta (wektory/tablice jako JSON). */
function plain(v: V | V[]): string | number | boolean {
  return typeof v === "object" ? JSON.stringify(v) : v;
}

/**
 * `bus_job` → JobConfig `kind: "bus"`. SCS nie opisało atrybutów w SDK; format odczytany z gry 1.62:
 *   bus.stages.count, bus.stages.current, income, planned_distance.km, bus_job.market,
 *   tablice per etap: source_stop.{id,name,type,departure_time.planned|actual,entering_passengers.planned|actual},
 *   destination_stop.{id,name,type,arrival_time.planned|actual,leaving_passengers.planned|actual}.
 * Źródło/cel zlecenia = przystanki bieżącego etapu (trasa GPS prowadzi do następnego przystanku).
 * Bez tablic (inna wersja gry) — te same nazwy co `job` + szukanie po fragmentach nazw. Komplet atrybutów
 * zostaje w `bus.raw` (Diagnostyka, `sdk-discovery.jsonl`).
 */
export function mapBusJob(attrs: Record<string, V | V[]>): JobConfig {
  const a: Record<string, V> = {};
  const raw: BusJobInfo["raw"] = {};
  for (const [k, v] of Object.entries(attrs)) {
    raw[k] = plain(v);
    a[k] = Array.isArray(v) ? (v[0] as V) : v;
  }
  const list = (k: string): V[] => {
    const v = attrs[k];
    return v === undefined ? [] : Array.isArray(v) ? v : [v];
  };
  const at = (k: string, i: number): V | undefined => list(k)[i];
  const numAt = (k: string, i: number): number | null => {
    const v = at(k, i);
    return typeof v === "number" ? v : null;
  };
  const stop = (side: "source_stop" | "destination_stop", i: number): BusStop => ({
    id: str(at(`${side}.id`, i)),
    name: str(at(`${side}.name`, i)) || str(at(`${side}.id`, i)),
    type: str(at(`${side}.type`, i)),
  });
  const count = Math.max(num(a["bus.stages.count"]), list("source_stop.id").length, list("destination_stop.id").length);
  const stages: BusStage[] = [];
  for (let i = 0; i < count; i++) {
    stages.push({
      from: stop("source_stop", i),
      to: stop("destination_stop", i),
      departPlanned: numAt("source_stop.departure_time.planned", i),
      departActual: numAt("source_stop.departure_time.actual", i),
      arrivePlanned: numAt("destination_stop.arrival_time.planned", i),
      arriveActual: numAt("destination_stop.arrival_time.actual", i),
      boardingPlanned: numAt("source_stop.entering_passengers.planned", i),
      boardingActual: numAt("source_stop.entering_passengers.actual", i),
      alightingPlanned: numAt("destination_stop.leaving_passengers.planned", i),
      alightingActual: numAt("destination_stop.leaving_passengers.actual", i),
    });
  }
  const current = Math.min(Math.max(0, Math.trunc(num(a["bus.stages.current"]))), Math.max(0, count - 1));
  const market = str(a["bus_job.market"]) || str(a["job.market"]);
  const income = num(a["income"]);
  const plannedDistanceKm = num(a["planned_distance.km"]);

  if (stages.length) {
    const st = stages[current]!;
    const place = (s: BusStop) => ({ city: s.name, cityId: s.id, company: "", companyId: "" });
    return {
      kind: "bus",
      cargo: "Pasażerowie",
      cargoId: "",
      mass: 0,
      income,
      deliveryTime: st.arrivePlanned,
      plannedDistanceKm,
      source: place(st.from),
      destination: place(st.to),
      market,
      special: false,
      cargoLoaded: true,
      bus: { passengers: onBoard(stages, current), capacity: null, stops: stages.length + 1, stages, current, market, raw },
    };
  }

  // inny format (bez tablic etapów): nazwy jak w `job` + szukanie po fragmentach
  const keys = Object.keys(a);
  const numBy = (re: RegExp, not?: RegExp): number | null => {
    const k = keys.find((x) => re.test(x) && !not?.test(x) && typeof a[x] === "number");
    return k ? (a[k] as number) : null;
  };
  const strBy = (re: RegExp): string => {
    const k = keys.find((x) => re.test(x) && typeof a[x] === "string" && a[x] !== "");
    return k ? (a[k] as string) : "";
  };
  const base = mapJob(a);
  const fill = (p: JobConfig["source"], side: "source" | "destination", alt: string) => ({
    city: p.city || strBy(new RegExp(`(${side}|${alt}).*city(?!.*id)`, "i")),
    cityId: p.cityId || strBy(new RegExp(`(${side}|${alt}).*city.*id`, "i")),
    company: p.company || strBy(new RegExp(`(${side}|${alt}).*(company|station|stop)(?!.*id)`, "i")),
    companyId: p.companyId || strBy(new RegExp(`(${side}|${alt}).*(company|station|stop).*id`, "i")),
  });
  return {
    ...base,
    kind: "bus",
    cargo: base.cargo || "Pasażerowie",
    source: fill(base.source, "source", "start|from|origin"),
    destination: fill(base.destination, "destination", "target|to|end"),
    income: base.income || (numBy(/income|revenue|reward|pay/i) ?? 0),
    plannedDistanceKm: base.plannedDistanceKm || (numBy(/distance/i) ?? 0),
    market: base.market || market,
    // „nie załadowano” ma sens tylko, gdy gra to podaje
    cargoLoaded: "is.cargo.loaded" in a ? base.cargoLoaded : true,
    bus: {
      passengers: numBy(/passeng/i, /capac|max|seat|limit/i),
      capacity: numBy(/capac|seat|max.*passeng|passeng.*(max|limit)/i),
      stops: numBy(/stop/i, /id$/i),
      stages: [],
      current: 0,
      market,
      raw,
    },
  };
}

/**
 * Pasażerowie na pokładzie w etapie `current`: wsiadający na przystankach, z których już odjechano
 * (bieżący etap — dopiero po odjeździe), minus wysiadający na przystankach już minionych. Faktyczne liczby
 * mają pierwszeństwo przed planem.
 */
export function onBoard(stages: readonly BusStage[], current: number): number | null {
  let n = 0;
  let known = false;
  for (let i = 0; i <= current && i < stages.length; i++) {
    const s = stages[i]!;
    if (i < current || s.departActual !== null) {
      const b = s.boardingActual ?? s.boardingPlanned;
      if (b !== null) {
        n += b;
        known = true;
      }
    }
    if (i < current || s.arriveActual !== null) n -= s.alightingActual ?? s.alightingPlanned ?? 0;
  }
  return known ? Math.max(0, n) : null;
}

function mapTruck(a: Record<string, V>): TruckConfig {
  return {
    brand: str(a["brand"]),
    brandId: str(a["brand_id"]),
    name: str(a["name"]),
    id: str(a["id"]),
    fuelCapacity: num(a["fuel.capacity"]),
    fuelWarningFactor: num(a["fuel.warning.factor"]),
    adblueCapacity: num(a["adblue.capacity"]),
    airPressureWarning: num(a["brake.air.pressure.warning"]),
    airPressureEmergency: num(a["brake.air.pressure.emergency"]),
    rpmLimit: num(a["rpm.limit"]),
    forwardGears: num(a["gears.forward"]),
    reverseGears: num(a["gears.reverse"]),
    retarderSteps: num(a["retarder.steps"]),
    licensePlate: str(a["license.plate"]) || null,
  };
}

function mapTrailer(index: number, a: Record<string, V>): TrailerConfig {
  return {
    index,
    id: str(a["id"]),
    name: str(a["name"]),
    brand: str(a["brand"]) || null,
    bodyType: str(a["body.type"]) || null,
    licensePlate: str(a["license.plate"]) || null,
  };
}
