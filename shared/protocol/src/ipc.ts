/**
 * IPC plugin (C++) ↔ bridge (Node) przez named pipe `\\.\pipe\yoga-auto`.
 *
 * RAMKA: uint32 little-endian długość payloadu (bajty) + payload UTF-8 JSON. Maks. 256 KiB.
 * Plugin = serwer pipe (1 klient naraz). Bridge łączy się z retry co 1 s.
 * Nazwy kanałów i atrybutów = dokładnie nazwy SDK (stringi `SCS_TELEMETRY_*`), bez tłumaczenia.
 * Tłumaczenie na FastState/SlowState robi bridge (bridge/src/mapping.ts).
 */

// ═══════════════════════════════ plugin → bridge ═══════════════════════════════

export interface IpcHello {
  t: "hello";
  ipc: number;
  plugin: { name: "yoga-auto"; version: string };
  game: { id: "eut2" | "ats"; name: string; version: string };
  /** wersje API zwrócone przez grę, np. "1.18" */
  api: { telemetry: string; input: string | null };
  /** kanały zarejestrowane z sukcesem */
  channels: string[];
  /** wejścia urządzeń */
  inputs: { semantical: string[]; generic: string[] };
  inputEnabled: boolean;
}

/** Zmienione kanały od poprzedniej ramki. Max 1 na klatkę gry; wątek IO może zlać kilka klatek w jedną. */
export interface IpcTelemetry {
  t: "tel";
  /** licznik klatek pluginu (frame_end) */
  frame: number;
  /** czas symulacji gry z frame_start, µs */
  simTime: number;
  /** czas renderu gry, µs */
  renderTime: number;
  paused: boolean;
  /**
   * Zmienione kanały. Klucz = nazwa kanału, dla kanałów indeksowanych `nazwa[index]`,
   * np. "truck.speed", "truck.wheel.rotation[3]". Przyczepy w formie SDK: "trailer.0.wear.chassis".
   * Wartości: number | boolean | string | {x,y,z} | {x,y,z,heading,pitch,roll} (dplacement).
   */
  ch: Record<string, IpcValue>;
}

export type IpcValue =
  | number
  | boolean
  | string
  | { x: number; y: number; z: number }
  | { x: number; y: number; z: number; heading: number; pitch: number; roll: number };

/** Event konfiguracyjny SDK. `attrs: null` = konfiguracja usunięta (np. brak zlecenia). */
export interface IpcConfig {
  t: "cfg";
  /** "job" | "truck" | "trailer" | "trailer.0".."trailer.9" | "controls" | "hshifter" | "substances" */
  id: string;
  attrs: Record<string, IpcValue | IpcValue[]> | null;
}

/** Gameplay event SDK. */
export interface IpcGameplay {
  t: "evt";
  /** "job.delivered" | "job.cancelled" | "player.fined" | "player.tollgate.paid" | "player.use.ferry" | "player.use.train" | "player.refuel.paid" | … */
  id: string;
  attrs: Record<string, IpcValue>;
}

export interface IpcInputActive {
  t: "input.active";
  device: "semantical" | "generic";
  active: boolean;
}

/** Potwierdzenie zastosowania wejścia w grze (po wydaniu wartości w on_event). */
export interface IpcInputAck {
  t: "in.ack";
  seq: number;
  frame: number;
  /** false = nieznane wejście / input wyłączony */
  ok: boolean;
}

export interface IpcLog {
  t: "log";
  level: "debug" | "info" | "warn" | "error";
  msg: string;
}

export type IpcFromPlugin = IpcHello | IpcTelemetry | IpcConfig | IpcGameplay | IpcInputActive | IpcInputAck | IpcLog;

// ═══════════════════════════════ bridge → plugin ═══════════════════════════════

/**
 * Wejście.
 * - press: plugin podaje true przez PRESS_FRAMES klatek, potem false.
 * - down/up: trzymanie; plugin zwalnia sam, jeśli przez HOLD_WATCHDOG_MS nie przyjdzie `hb`.
 * - axis: wartość float (zarezerwowane, MVP nie używa).
 */
export interface IpcInput {
  t: "in";
  seq: number;
  device: "semantical" | "generic";
  input: string;
  op: "press" | "down" | "up" | "axis";
  value?: number;
}

/** Heartbeat co 250 ms. Brak przez HOLD_WATCHDOG_MS → plugin zwalnia wszystkie wejścia. */
export interface IpcHeartbeat {
  t: "hb";
}

export interface IpcReleaseAll {
  t: "releaseAll";
}

export interface IpcSetOptions {
  t: "opts";
  inputEnabled?: boolean;
  /** 0 = każda klatka; >0 = min. odstęp między ramkami `tel` w ms (np. 8) */
  telMinIntervalMs?: number;
}

export type IpcToPlugin = IpcInput | IpcHeartbeat | IpcReleaseAll | IpcSetOptions;

export const IPC_MAX_FRAME_BYTES = 256 * 1024;
export const IPC_HEARTBEAT_MS = 250;

/**
 * Kanały, które plugin rejestruje (minimalny zestaw MVP + mapa).
 * `idx` = liczba indeksów; `{i}` w nazwie zastępowane 0..idx-1 (przyczepy: "trailer.0.connected").
 * Brak kanału w danej wersji gry NIE jest błędem: plugin pomija go i nie umieszcza w `hello.channels`.
 */
export const PLUGIN_CHANNELS: readonly {
  name: string;
  type: "float" | "double" | "bool" | "u32" | "s32" | "u64" | "dplacement" | "fvector";
  idx?: number;
  fast?: true;
}[] = [
  { name: "truck.speed", type: "float", fast: true },
  { name: "truck.engine.rpm", type: "float", fast: true },
  { name: "truck.displayed.gear", type: "s32", fast: true },
  { name: "truck.cruise_control", type: "float", fast: true },
  { name: "truck.effective.throttle", type: "float", fast: true },
  { name: "truck.effective.brake", type: "float", fast: true },
  { name: "truck.light.parking", type: "bool", fast: true },
  { name: "truck.light.beam.low", type: "bool", fast: true },
  { name: "truck.light.beam.high", type: "bool", fast: true },
  { name: "truck.light.beacon", type: "bool", fast: true },
  { name: "truck.light.aux.front", type: "u32", fast: true },
  { name: "truck.light.aux.roof", type: "u32", fast: true },
  { name: "truck.light.lblinker", type: "bool", fast: true },
  { name: "truck.light.rblinker", type: "bool", fast: true },
  { name: "truck.light.brake", type: "bool", fast: true },
  { name: "truck.light.reverse", type: "bool", fast: true },
  { name: "truck.lblinker", type: "bool", fast: true },
  { name: "truck.rblinker", type: "bool", fast: true },
  { name: "truck.hazard.warning", type: "bool", fast: true },
  { name: "truck.brake.parking", type: "bool", fast: true },
  { name: "truck.brake.motor", type: "bool", fast: true },
  { name: "truck.brake.retarder", type: "u32", fast: true },
  { name: "truck.engine.enabled", type: "bool", fast: true },
  { name: "truck.electric.enabled", type: "bool", fast: true },
  { name: "truck.world.placement", type: "dplacement", fast: true },
  { name: "truck.fuel.amount", type: "float" },
  { name: "truck.fuel.range", type: "float" },
  { name: "truck.fuel.consumption.average", type: "float" },
  { name: "truck.fuel.warning", type: "bool" },
  { name: "truck.adblue", type: "float" },
  { name: "truck.adblue.warning", type: "bool" },
  { name: "truck.brake.air.pressure", type: "float" },
  { name: "truck.brake.air.pressure.warning", type: "bool" },
  { name: "truck.brake.air.pressure.emergency", type: "bool" },
  { name: "truck.brake.temperature", type: "float" },
  { name: "truck.oil.temperature", type: "float" },
  { name: "truck.oil.pressure", type: "float" },
  { name: "truck.oil.pressure.warning", type: "bool" },
  { name: "truck.water.temperature", type: "float" },
  { name: "truck.water.temperature.warning", type: "bool" },
  { name: "truck.battery.voltage", type: "float" },
  { name: "truck.battery.voltage.warning", type: "bool" },
  { name: "truck.wear.engine", type: "float" },
  { name: "truck.wear.transmission", type: "float" },
  { name: "truck.wear.cabin", type: "float" },
  { name: "truck.wear.chassis", type: "float" },
  { name: "truck.wear.wheels", type: "float" },
  { name: "truck.odometer", type: "float" },
  { name: "truck.wipers", type: "bool" },
  { name: "truck.differential_lock", type: "bool" },
  { name: "truck.lift_axle", type: "bool" },
  { name: "truck.trailer.lift_axle", type: "bool" },
  { name: "truck.navigation.distance", type: "float" },
  { name: "truck.navigation.time", type: "float" },
  { name: "truck.navigation.speed.limit", type: "float" },
  { name: "game.time", type: "u32" },
  { name: "rest.stop", type: "s32" },
  { name: "local.scale", type: "float" },
  { name: "trailer.{i}.connected", type: "bool", idx: 10 },
  { name: "trailer.{i}.cargo.damage", type: "float", idx: 10 },
  { name: "trailer.{i}.wear.chassis", type: "float", idx: 10 },
  { name: "trailer.{i}.wear.wheels", type: "float", idx: 10 },
  { name: "trailer.{i}.wear.body", type: "float", idx: 10 },
];
// Nazwy sprawdzone 2026-11-22 z nagłówkami SDK 1.16 (include/common/*.h) — wszystkie istnieją.
// Rozbieżność = poprawka tej listy przez lead (minor bump), nie lokalny hack w pluginie.
