/** Stany początkowe (brak danych). Używane przez bridge (StateStore), UI (store) i testy. */
import type { ConfigState, FastState, FullState, GameStatus, LightsState, SlowState, TripState } from "./state.ts";

export function emptyLights(): LightsState {
  return {
    parking: false,
    low: false,
    high: false,
    beacon: false,
    auxFront: "off",
    auxRoof: "off",
    blinkerLeftOn: false,
    blinkerRightOn: false,
    brake: false,
    reverse: false,
  };
}

export function emptyFast(): FastState {
  return {
    speed: 0,
    rpm: 0,
    gear: 0,
    cruise: 0,
    throttle: 0,
    brake: 0,
    lights: emptyLights(),
    hazard: false,
    blinker: "off",
    parkingBrake: false,
    motorBrake: false,
    retarder: 0,
    engineOn: false,
    electricOn: false,
    placement: null,
  };
}

export function emptyTrip(now = 0): TripState {
  return { distance: 0, fuelUsed: 0, driveTime: 0, instantConsumption: null, resetAt: now };
}

export function emptySlow(): SlowState {
  return {
    fuel: { amount: 0, rangeKm: 0, avgConsumption: 0, warning: false },
    adblue: { amount: 0, warning: false },
    air: { pressure: 0, warning: false, emergency: false },
    temps: { oil: 0, water: 0, brake: 0 },
    oilPressure: { value: 0, warning: false },
    waterTempWarning: false,
    battery: { voltage: 0, warning: false },
    wear: { engine: 0, transmission: 0, cabin: 0, chassis: 0, wheels: 0 },
    trailers: [],
    nav: { distance: null, time: null, speedLimit: 0 },
    time: { game: 0, restStopMin: null, scale: 1 },
    odometer: 0,
    wipers: false,
    diffLock: false,
    liftAxle: false,
    trailerLiftAxle: false,
    trip: emptyTrip(),
  };
}

export function emptyConfig(): ConfigState {
  return { truck: null, job: null, trailers: [] };
}

export function defaultStatus(source: GameStatus["source"] = "pipe"): GameStatus {
  return {
    source,
    connected: false,
    paused: false,
    game: null,
    gameVersion: null,
    inputActive: false,
    inputEnabled: true,
  };
}

export function emptyFullState(source: GameStatus["source"] = "pipe"): FullState {
  return {
    status: defaultStatus(source),
    fast: emptyFast(),
    slow: emptySlow(),
    config: emptyConfig(),
    alerts: [],
    media: null,
  };
}
