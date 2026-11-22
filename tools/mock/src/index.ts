/**
 * MockSource — udaje plugin gry na poziomie IPC (surowe nazwy kanałów i atrybutów SDK).
 * Dzięki temu bridge (mapping, throttling, CommandRouter) działa na mocku identycznie jak na grze.
 *
 * Scenariusze: highway | city-night | low-fuel | crash | job-cycle
 */
import {
  ACTIONS,
  IPC_VERSION,
  PRESS_FRAMES,
  HOLD_WATCHDOG_MS,
  ipc,
  type SourceMsg,
  type TelemetrySource,
} from "@yoga-auto/protocol";

export type MockScenario = "highway" | "city-night" | "low-fuel" | "crash" | "job-cycle";
export const MOCK_SCENARIOS: readonly MockScenario[] = ["highway", "city-night", "low-fuel", "crash", "job-cycle"];

export interface MockOptions {
  scenario?: MockScenario;
  /** częstotliwość „klatek gry” */
  fps?: number;
  /** przyspieszenie czasu symulacji */
  speed?: number;
  /** deterministyczny seed */
  seed?: number;
  /** bez timera: czas „gry” posuwa wyłącznie `advance(dt)` (generowanie próbek, testy deterministyczne) */
  manual?: boolean;
}

type V = ipc.IpcValue;
const KMH = 1 / 3.6;
const FUEL_CAP = 1000;

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000;
}

interface Sim {
  t: number;
  speed: number;
  target: number;
  cruise: number;
  lastCruise: number;
  gear: number;
  rpm: number;
  throttle: number;
  brake: number;
  fuel: number;
  adblue: number;
  odometer: number;
  air: number;
  lightsMode: 0 | 1 | 2; // off, parking, low
  high: boolean;
  beacon: boolean;
  hazard: boolean;
  blinker: "off" | "left" | "right";
  parkingBrake: boolean;
  motorBrake: boolean;
  retarder: number;
  engine: boolean;
  electric: boolean;
  wipers: boolean;
  diffLock: boolean;
  liftAxle: boolean;
  trailerLiftAxle: boolean;
  trailer: boolean;
  wear: { engine: number; transmission: number; cabin: number; chassis: number; wheels: number };
  cargoDamage: number;
  navDistance: number;
  gameTime: number;
  restStop: number;
  paused: boolean;
  x: number;
  z: number;
  heading: number;
  job: boolean;
}

const JOB_ATTRS: Record<string, V> = {
  "cargo.id": "electronics",
  cargo: "Elektronika",
  "cargo.mass": 18000,
  income: 18450,
  "delivery.time": 600 * 60 + 16 * 60,
  "planned_distance.km": 812,
  "source.city.id": "wroclaw",
  "source.city": "Wrocław",
  "source.company.id": "tradeaux",
  "source.company": "Tradeaux",
  "destination.city.id": "hamburg",
  "destination.city": "Hamburg",
  "destination.company.id": "lkw",
  "destination.company": "LKW",
  "job.market": "freight_market",
  "is.cargo.loaded": true,
  "special.job": false,
};

const TRUCK_ATTRS: Record<string, V> = {
  brand_id: "scania",
  brand: "Scania",
  id: "vehicle.scania.s_2016",
  name: "S",
  "fuel.capacity": FUEL_CAP,
  "fuel.warning.factor": 0.15,
  "adblue.capacity": 80,
  "brake.air.pressure.warning": 65,
  "brake.air.pressure.emergency": 30,
  "rpm.limit": 2500,
  "gears.forward": 12,
  "gears.reverse": 2,
  "retarder.steps": 5,
  "license.plate": "DW 12345",
};

export class MockSource implements TelemetrySource {
  readonly kind = "mock" as const;
  private handlers = new Set<(m: SourceMsg) => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private frame = 0;
  private prev = new Map<string, string>();
  private sim: Sim;
  private rand: () => number;
  private scenario: MockScenario;
  private fps: number;
  private timeScale: number;
  private holds = new Map<string, number>();
  private lastHb = Date.now();
  private inputEnabled = true;
  private manual: boolean;

  constructor(opts: MockOptions = {}) {
    this.scenario = opts.scenario ?? "highway";
    this.fps = opts.fps ?? 60;
    this.timeScale = opts.speed ?? 1;
    this.rand = rng(opts.seed ?? 42);
    this.manual = opts.manual ?? false;
    this.sim = this.initial();
  }

  onMessage(handler: (m: SourceMsg) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  async start(): Promise<void> {
    if (this.timer) return;
    this.emit({ t: "connected" });
    this.emit(this.hello());
    this.emit({ t: "cfg", id: "truck", attrs: TRUCK_ATTRS });
    this.emit({
      t: "cfg",
      id: "trailer.0",
      attrs: {
        id: "trailer.box",
        name: "Chłodnia",
        brand: "Krone",
        "body.type": "refrigerated",
        "license.plate": "DW 99887",
      },
    });
    if (this.sim.job) this.emit({ t: "cfg", id: "job", attrs: JOB_ATTRS });
    this.emit({ t: "input.active", device: "semantical", active: true });
    if (this.manual) return;
    const dt = 1 / this.fps;
    this.timer = setInterval(() => this.step(dt * this.timeScale), 1000 / this.fps);
  }

  /** Tryb `manual`: jedna klatka „gry” o długości `dtSeconds` czasu symulacji (domyślnie 1/fps). */
  advance(dtSeconds: number = 1 / this.fps): void {
    this.step(dtSeconds);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.emit({ t: "disconnected", reason: "mock stopped" });
  }

  send(msg: ipc.IpcToPlugin): void {
    switch (msg.t) {
      case "hb":
        this.lastHb = Date.now();
        return;
      case "releaseAll":
        this.holds.clear();
        return;
      case "opts":
        if (msg.inputEnabled !== undefined) this.inputEnabled = msg.inputEnabled;
        return;
      case "in": {
        const known = this.knownInputs().has(msg.input);
        const ok = known && this.inputEnabled;
        if (ok) {
          if (msg.op === "press") setTimeout(() => this.apply(msg.input), (PRESS_FRAMES * 1000) / this.fps);
          else if (msg.op === "down") this.holds.set(msg.input, Date.now());
          else if (msg.op === "up") this.holds.delete(msg.input);
        }
        setTimeout(() => this.emit({ t: "in.ack", seq: msg.seq, frame: this.frame, ok }), 1000 / this.fps);
        return;
      }
    }
  }

  // ───────────────────────────────── internals ─────────────────────────────────

  private emit(m: SourceMsg): void {
    for (const h of this.handlers) h(m);
  }

  private knownInputs(): Set<string> {
    const s = new Set<string>();
    for (const a of Object.values(ACTIONS))
      for (const n of ([] as string[]).concat(a.scs as string | string[])) s.add(n);
    return s;
  }

  private hello(): ipc.IpcHello {
    const channels: string[] = [];
    for (const c of ipc.PLUGIN_CHANNELS) {
      if (c.idx) for (let i = 0; i < c.idx; i++) channels.push(c.name.replace("{i}", String(i)));
      else channels.push(c.name);
    }
    return {
      t: "hello",
      ipc: IPC_VERSION,
      plugin: { name: "yoga-auto", version: "mock" },
      game: { id: "eut2", name: "Euro Truck Simulator 2 (mock)", version: "1.62" },
      api: { telemetry: "1.18", input: "1.00" },
      channels,
      inputs: { semantical: [...this.knownInputs()].sort(), generic: [] },
      inputEnabled: this.inputEnabled,
    };
  }

  private initial(): Sim {
    const night = this.scenario === "city-night";
    return {
      t: 0,
      speed: 0,
      target: this.scenario === "city-night" ? 50 * KMH : 85 * KMH,
      cruise: 0,
      lastCruise: 0,
      gear: 0,
      rpm: 650,
      throttle: 0,
      brake: 0,
      fuel: this.scenario === "low-fuel" ? 0.17 * FUEL_CAP : 0.63 * FUEL_CAP,
      adblue: 52,
      odometer: 184_233,
      air: 120,
      lightsMode: night ? 2 : 0,
      high: false,
      beacon: false,
      hazard: false,
      blinker: "off",
      parkingBrake: false,
      motorBrake: false,
      retarder: 0,
      engine: true,
      electric: true,
      wipers: false,
      diffLock: false,
      liftAxle: false,
      trailerLiftAxle: false,
      trailer: true,
      wear: { engine: 0.02, transmission: 0.015, cabin: 0.01, chassis: 0.03, wheels: 0.02 },
      cargoDamage: 0,
      navDistance: 812_000,
      gameTime: (night ? 2 * 1440 + 22 * 60 : 2 * 1440 + 8 * 60) + 17,
      restStop: 190,
      paused: false,
      x: -9123,
      z: 14022,
      heading: 0.25,
      job: true,
    };
  }

  private apply(input: string): void {
    const s = this.sim;
    switch (input) {
      case "light":
        s.lightsMode = ((s.lightsMode + 1) % 3) as 0 | 1 | 2;
        if (s.lightsMode !== 2) s.high = false;
        break;
      case "lightoff":
        s.lightsMode = 0;
        s.high = false;
        break;
      case "hblight":
        if (s.lightsMode === 2) s.high = !s.high;
        break;
      case "beacon":
        s.beacon = !s.beacon;
        break;
      case "flasher4way":
        s.hazard = !s.hazard;
        break;
      case "lblinker":
        s.blinker = s.blinker === "left" ? "off" : "left";
        break;
      case "rblinker":
        s.blinker = s.blinker === "right" ? "off" : "right";
        break;
      case "parkingbrake":
        s.parkingBrake = !s.parkingBrake;
        break;
      case "motorbrake":
        s.motorBrake = !s.motorBrake;
        break;
      case "retarderup":
        s.retarder = Math.min(5, s.retarder + 1);
        break;
      case "retarderdown":
        s.retarder = Math.max(0, s.retarder - 1);
        break;
      case "cruiectrl":
        if (s.cruise > 0) s.cruise = 0;
        else if (s.speed > 30 * KMH) s.cruise = s.lastCruise = Math.round(s.speed / KMH) * KMH;
        break;
      case "cruiectrlinc":
        if (s.cruise > 0) s.cruise = s.lastCruise = s.cruise + 1 * KMH;
        break;
      case "cruiectrldec":
        if (s.cruise > 0) s.cruise = s.lastCruise = Math.max(30 * KMH, s.cruise - 1 * KMH);
        break;
      case "cruiectrlres":
        if (s.cruise === 0 && s.lastCruise > 0) s.cruise = s.lastCruise;
        break;
      case "engine":
        s.engine = !s.engine;
        if (s.engine) s.electric = true;
        break;
      case "engineelect":
        s.electric = !s.electric;
        if (!s.electric) s.engine = false;
        break;
      case "diflock":
        s.diffLock = !s.diffLock;
        break;
      case "liftaxle":
        s.liftAxle = !s.liftAxle;
        break;
      case "liftaxlet":
        s.trailerLiftAxle = !s.trailerLiftAxle;
        break;
      case "attach":
        s.trailer = !s.trailer;
        break;
      case "wipers":
      case "wipers1":
      case "wipers2":
      case "wipers3":
      case "wipers4":
        s.wipers = true;
        break;
      case "wipersback":
      case "wipers0":
        s.wipers = false;
        break;
      case "pause":
        s.paused = !s.paused;
        this.emit({ t: "log", level: "info", msg: `mock pause=${s.paused}` });
        break;
      default:
        break; // klakson, kamery, radio… — brak stanu w telemetrii
    }
  }

  private step(dt: number): void {
    const s = this.sim;
    this.frame++;
    if (this.holds.size && Date.now() - this.lastHb > HOLD_WATCHDOG_MS) this.holds.clear();

    if (!s.paused) {
      s.t += dt;
      this.scenarioTick(dt);
      const target = s.parkingBrake || !s.engine ? 0 : s.cruise > 0 ? s.cruise : s.target;
      const diff = target - s.speed;
      const accel = diff > 0 ? Math.min(diff, 0.9 * dt) : Math.max(diff, -(2.5 + s.retarder * 0.4) * dt);
      s.speed = Math.max(0, s.speed + accel);
      s.throttle = diff > 0.2 ? 0.6 + this.rand() * 0.1 : 0.05;
      s.brake = diff < -0.5 ? 0.4 : 0;
      s.gear = s.speed < 0.3 ? (s.engine ? 0 : 0) : Math.min(12, 1 + Math.floor(s.speed / KMH / 7.5));
      const base =
        s.gear === 0 ? 650 : 900 + ((s.speed / KMH) % 7.5) * 60 + (s.gear >= 12 ? (s.speed / KMH - 82) * 15 : 0);
      s.rpm = s.engine ? Math.max(600, base + (this.rand() - 0.5) * 20) : 0;
      const dist = s.speed * dt;
      s.odometer += dist / 1000;
      s.navDistance = Math.max(0, s.navDistance - dist);
      s.fuel = Math.max(0, s.fuel - (dist / 1000) * 0.32 - (s.engine ? 0.0005 * dt : 0));
      s.adblue = Math.max(0, s.adblue - (dist / 1000) * 0.016);
      s.gameTime += (dt * 19) / 60;
      s.restStop -= (dt * 19) / 60;
      s.heading = (s.heading + 0.00002 * s.speed * dt) % 1;
      s.x += Math.sin(s.heading * 2 * Math.PI) * -dist;
      s.z += Math.cos(s.heading * 2 * Math.PI) * -dist;
    }
    this.emitTel();
  }

  private scenarioTick(dt: number): void {
    const s = this.sim;
    switch (this.scenario) {
      case "highway":
        if (s.t > 25 && s.cruise === 0 && s.speed > 80 * KMH) s.cruise = s.lastCruise = 85 * KMH;
        break;
      case "city-night": {
        const phase = s.t % 40;
        s.target = phase < 25 ? 50 * KMH : 0;
        s.blinker = phase > 22 && phase < 30 ? "right" : s.blinker === "right" && phase >= 30 ? "off" : s.blinker;
        break;
      }
      case "low-fuel":
        if (s.t > 10 && s.cruise === 0 && s.speed > 80 * KMH) s.cruise = s.lastCruise = 85 * KMH;
        break;
      case "crash":
        if (Math.abs(s.t - 20) < dt / 2 + 1e-9) {
          s.wear.cabin += 0.06;
          s.wear.chassis += 0.04;
          s.cargoDamage += 0.03;
          s.speed *= 0.3;
          s.cruise = 0;
        }
        if (s.t > 20 && s.t < 22) s.target = 0;
        else s.target = 85 * KMH;
        break;
      case "job-cycle":
        if (s.job && s.t > 60) {
          s.job = false;
          this.emit({
            t: "evt",
            id: "job.delivered",
            attrs: {
              revenue: 18450,
              "earned.xp": 742,
              "cargo.damage": s.cargoDamage,
              "distance.km": 812,
              "delivery.time": 731,
              "auto.park.used": false,
              "auto.load.used": false,
            },
          });
          this.emit({ t: "cfg", id: "job", attrs: null });
          s.target = 0;
        }
        if (!s.job && s.t > 75) {
          s.job = true;
          s.t = 0;
          s.navDistance = 812_000;
          s.target = 85 * KMH;
          this.emit({ t: "cfg", id: "job", attrs: JOB_ATTRS });
        }
        break;
    }
  }

  private emitTel(): void {
    const s = this.sim;
    const blinkOn = Math.floor(s.t * 1.6) % 2 === 0;
    const ch: Record<string, V> = {
      "truck.speed": s.speed,
      "truck.engine.rpm": s.rpm,
      "truck.displayed.gear": s.gear,
      "truck.cruise_control": s.cruise,
      "truck.effective.throttle": s.throttle,
      "truck.effective.brake": s.brake,
      "truck.light.parking": s.lightsMode >= 1,
      "truck.light.beam.low": s.lightsMode === 2,
      "truck.light.beam.high": s.high,
      "truck.light.beacon": s.beacon,
      "truck.light.aux.front": 0,
      "truck.light.aux.roof": 0,
      "truck.light.lblinker": (s.hazard || s.blinker === "left") && blinkOn,
      "truck.light.rblinker": (s.hazard || s.blinker === "right") && blinkOn,
      "truck.light.brake": s.brake > 0,
      "truck.light.reverse": false,
      "truck.lblinker": s.blinker === "left",
      "truck.rblinker": s.blinker === "right",
      "truck.hazard.warning": s.hazard,
      "truck.brake.parking": s.parkingBrake,
      "truck.brake.motor": s.motorBrake,
      "truck.brake.retarder": s.retarder,
      "truck.engine.enabled": s.engine,
      "truck.electric.enabled": s.electric,
      "truck.world.placement": { x: s.x, y: 52, z: s.z, heading: s.heading, pitch: 0, roll: 0 },
      "truck.fuel.amount": round(s.fuel, 1),
      "truck.fuel.range": round(s.fuel / 0.32, 0),
      "truck.fuel.consumption.average": 0.32,
      "truck.fuel.warning": s.fuel < 0.15 * FUEL_CAP,
      "truck.adblue": round(s.adblue, 1),
      "truck.adblue.warning": s.adblue < 8,
      "truck.brake.air.pressure": 120,
      "truck.brake.air.pressure.warning": false,
      "truck.brake.air.pressure.emergency": false,
      "truck.brake.temperature": 40,
      "truck.oil.temperature": round(85 + Math.min(10, s.t / 30), 0),
      "truck.oil.pressure": 60,
      "truck.oil.pressure.warning": false,
      "truck.water.temperature": 82,
      "truck.water.temperature.warning": false,
      "truck.battery.voltage": 27.6,
      "truck.battery.voltage.warning": false,
      "truck.wear.engine": round(s.wear.engine, 3),
      "truck.wear.transmission": round(s.wear.transmission, 3),
      "truck.wear.cabin": round(s.wear.cabin, 3),
      "truck.wear.chassis": round(s.wear.chassis, 3),
      "truck.wear.wheels": round(s.wear.wheels, 3),
      "truck.odometer": round(s.odometer, 1),
      "truck.wipers": s.wipers,
      "truck.differential_lock": s.diffLock,
      "truck.lift_axle": s.liftAxle,
      "truck.trailer.lift_axle": s.trailerLiftAxle,
      "truck.navigation.distance": s.job ? round(s.navDistance, 0) : 0,
      "truck.navigation.time": s.job ? round(s.navDistance / (80 * KMH), 0) : 0,
      "truck.navigation.speed.limit": this.scenario === "city-night" ? 50 * KMH : 80 * KMH,
      "game.time": Math.floor(s.gameTime),
      "rest.stop": Math.floor(s.restStop),
      "local.scale": 19,
      "trailer.0.connected": s.trailer,
      "trailer.0.cargo.damage": round(s.cargoDamage, 3),
      "trailer.0.wear.chassis": 0.02,
      "trailer.0.wear.wheels": 0.01,
      "trailer.0.wear.body": 0.01,
    };
    // hello ogłasza trailer.0..9 — pierwsza ramka tel musi mieć pełny zestaw kanałów (PROTOCOL.md §5)
    for (let i = 1; i < 10; i++) {
      ch[`trailer.${i}.connected`] = false;
      ch[`trailer.${i}.cargo.damage`] = 0;
      ch[`trailer.${i}.wear.chassis`] = 0;
      ch[`trailer.${i}.wear.wheels`] = 0;
      ch[`trailer.${i}.wear.body`] = 0;
    }
    const changed: Record<string, V> = {};
    for (const [k, v] of Object.entries(ch)) {
      const key = typeof v === "object" ? JSON.stringify(v) : String(v);
      if (this.prev.get(k) !== key) {
        changed[k] = v;
        this.prev.set(k, key);
      }
    }
    const us = Math.round(s.t * 1e6);
    this.emit({ t: "tel", frame: this.frame, simTime: us, renderTime: us, paused: s.paused, ch: changed });
  }
}

function round(v: number, d: number): number {
  const p = 10 ** d;
  return Math.round(v * p) / p;
}

export function createMockSource(opts?: MockOptions): MockSource {
  return new MockSource(opts);
}
