/**
 * Surowe kanały/atrybuty SDK (IPC) → FastState / SlowState / ConfigState.
 * F0: mapowanie bazowe. S2: progi, eventy pochodne (job.started, trailer.attached), trip, alerty.
 */
import type { ConfigState, JobConfig, TrailerConfig, TrailerState, TruckConfig, ipc } from "@yoga-auto/protocol";
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

export function applyConfig(store: StateStore, cfg: ipc.IpcConfig): void {
  const a = cfg.attrs as Record<string, V> | null;
  if (cfg.id === "job") store.setConfig("job", a ? mapJob(a) : null);
  else if (cfg.id === "truck") store.setConfig("truck", a ? mapTruck(a) : null);
  else if (cfg.id === "trailer" || cfg.id.startsWith("trailer.")) {
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
