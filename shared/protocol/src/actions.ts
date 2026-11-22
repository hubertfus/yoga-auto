/**
 * KATALOG AKCJI — jedno źródło prawdy dla UI, bridge'a i pluginu.
 *
 * `scs`      — nazwa kontrolki gry (urządzenie semantical) albo nazwa wejścia urządzenia generic.
 * `device`   — "semantical" (bez bindowania) | "generic" (użytkownik przypisuje raz w Opcjach → Sterowanie)
 *              | "keyboard" (fallback SendInput w bridge — tylko gdy nic innego nie działa).
 * `kind`     — "press": impuls (plugin trzyma true przez PRESS_FRAMES klatek)
 *              "hold":  down/up z UI (klakson, kierunkowskaz trzymany), watchdog HOLD_WATCHDOG_MS
 *              "set":   stan docelowy, bridge sam wylicza sekwencję press-ów i weryfikuje z telemetrią
 * `verified` — nazwa `scs` występuje jako `semantical.<mix>` w controls.sii ETS2 1.62 (sprawdzone 2026-11-22 na profilu
 *              właściciela). To NIE jest jeszcze test w grze — ten robi S1-0.
 * `state`    — ścieżka w stanie (fast/slow), z której UI czyta podświetlenie przycisku.
 *
 * Skrypt `npm run gen -w @yoga-auto/protocol` (Faza 0) generuje z tego:
 *   - plugin/generated/actions.gen.h  (lista wejść do rejestracji w SDK)
 *   - shared/protocol/generated/actions.json
 */

export const PRESS_FRAMES = 3;
export const HOLD_WATCHDOG_MS = 3000;
export const HOLD_MAX_MS = 10000;

export type ActionKind = "press" | "hold" | "set";
export type ActionDevice = "semantical" | "generic" | "keyboard";
export type ActionGroup =
  | "lights"
  | "signals"
  | "drive"
  | "brakes"
  | "cruise"
  | "axles"
  | "trailer"
  | "horn"
  | "camera"
  | "radio"
  | "ui"
  | "misc";

export interface ActionDef {
  readonly kind: ActionKind;
  readonly group: ActionGroup;
  readonly scs: string | readonly string[];
  readonly device: ActionDevice;
  readonly verified: boolean;
  readonly state?: string;
  /** dla kind:"set" — dozwolone wartości */
  readonly values?: readonly string[];
  readonly label: string;
}

export const ACTIONS = {
  // ── Światła ───────────────────────────────────────────────────────────────
  "lights.cycle": {
    kind: "press",
    group: "lights",
    scs: "light",
    device: "semantical",
    verified: true,
    state: "fast.lights",
    label: "Światła (cykl)",
  },
  "lights.mode": {
    kind: "set",
    group: "lights",
    scs: "light",
    device: "semantical",
    verified: true,
    state: "fast.lights",
    values: ["off", "parking", "low"],
    label: "Światła",
  },
  "lights.off": {
    kind: "press",
    group: "lights",
    scs: "lightoff",
    device: "semantical",
    verified: true,
    state: "fast.lights",
    label: "Światła wył.",
  },
  "lights.high": {
    kind: "press",
    group: "lights",
    scs: "hblight",
    device: "semantical",
    verified: true,
    state: "fast.lights.high",
    label: "Drogowe",
  },
  "lights.flash": {
    kind: "hold",
    group: "lights",
    scs: "lighthorn",
    device: "semantical",
    verified: true,
    label: "Mrugnięcie",
  },
  "lights.beacon": {
    kind: "press",
    group: "lights",
    scs: "beacon",
    device: "semantical",
    verified: true,
    state: "fast.lights.beacon",
    label: "Kogut",
  },
  "lights.hazard": {
    kind: "press",
    group: "signals",
    scs: "flasher4way",
    device: "semantical",
    verified: true,
    state: "fast.hazard",
    label: "Awaryjne",
  },
  // ── Kierunkowskazy ────────────────────────────────────────────────────────
  "blinker.left": {
    kind: "press",
    group: "signals",
    scs: "lblinker",
    device: "semantical",
    verified: true,
    state: "fast.blinker",
    label: "Lewy",
  },
  "blinker.right": {
    kind: "press",
    group: "signals",
    scs: "rblinker",
    device: "semantical",
    verified: true,
    state: "fast.blinker",
    label: "Prawy",
  },
  "blinker.leftHold": {
    kind: "hold",
    group: "signals",
    scs: "lblinkerh",
    device: "semantical",
    verified: true,
    state: "fast.blinker",
    label: "Lewy (trzymaj)",
  },
  "blinker.rightHold": {
    kind: "hold",
    group: "signals",
    scs: "rblinkerh",
    device: "semantical",
    verified: true,
    state: "fast.blinker",
    label: "Prawy (trzymaj)",
  },
  // ── Wycieraczki ───────────────────────────────────────────────────────────
  "wipers.up": {
    kind: "press",
    group: "misc",
    scs: "wipers",
    device: "semantical",
    verified: true,
    state: "slow.wipers",
    label: "Wycieraczki +",
  },
  "wipers.down": {
    kind: "press",
    group: "misc",
    scs: "wipersback",
    device: "semantical",
    verified: true,
    state: "slow.wipers",
    label: "Wycieraczki −",
  },
  "wipers.level": {
    kind: "set",
    group: "misc",
    scs: ["wipers0", "wipers1", "wipers2", "wipers3", "wipers4"],
    device: "semantical",
    verified: true,
    state: "slow.wipers",
    values: ["0", "1", "2", "3", "4"],
    label: "Wycieraczki",
  },
  // ── Silnik / jazda ────────────────────────────────────────────────────────
  "engine.toggle": {
    kind: "press",
    group: "drive",
    scs: "engine",
    device: "semantical",
    verified: true,
    state: "fast.engineOn",
    label: "Silnik",
  },
  "electric.toggle": {
    kind: "press",
    group: "drive",
    scs: "engineelect",
    device: "semantical",
    verified: true,
    state: "fast.electricOn",
    label: "Zapłon",
  },
  // ── Hamulce ───────────────────────────────────────────────────────────────
  "parkingBrake.toggle": {
    kind: "press",
    group: "brakes",
    scs: "parkingbrake",
    device: "semantical",
    verified: true,
    state: "fast.parkingBrake",
    label: "Ręczny",
  },
  "motorBrake.toggle": {
    kind: "press",
    group: "brakes",
    scs: "motorbrake",
    device: "semantical",
    verified: true,
    state: "fast.motorBrake",
    label: "Hamulec silnikowy",
  },
  "retarder.up": {
    kind: "press",
    group: "brakes",
    scs: "retarderup",
    device: "semantical",
    verified: true,
    state: "fast.retarder",
    label: "Retarder +",
  },
  "retarder.down": {
    kind: "press",
    group: "brakes",
    scs: "retarderdown",
    device: "semantical",
    verified: true,
    state: "fast.retarder",
    label: "Retarder −",
  },
  "retarder.level": {
    kind: "set",
    group: "brakes",
    scs: ["retarderup", "retarderdown"],
    device: "semantical",
    verified: true,
    state: "fast.retarder",
    values: ["0", "1", "2", "3", "4", "5"],
    label: "Retarder",
  },
  // ── Tempomat ──────────────────────────────────────────────────────────────
  "cruise.set": {
    kind: "press",
    group: "cruise",
    scs: "cruiectrl",
    device: "semantical",
    verified: true,
    state: "fast.cruise",
    label: "Tempomat",
  },
  "cruise.inc": {
    kind: "press",
    group: "cruise",
    scs: "cruiectrlinc",
    device: "semantical",
    verified: true,
    state: "fast.cruise",
    label: "Tempomat +",
  },
  "cruise.dec": {
    kind: "press",
    group: "cruise",
    scs: "cruiectrldec",
    device: "semantical",
    verified: true,
    state: "fast.cruise",
    label: "Tempomat −",
  },
  "cruise.resume": {
    kind: "press",
    group: "cruise",
    scs: "cruiectrlres",
    device: "semantical",
    verified: true,
    state: "fast.cruise",
    label: "Wznów",
  },
  // ── Osie / przyczepa ──────────────────────────────────────────────────────
  "diffLock.toggle": {
    kind: "press",
    group: "axles",
    scs: "diflock",
    device: "semantical",
    verified: true,
    state: "slow.diffLock",
    label: "Blokada mostu",
  },
  "liftAxle.toggle": {
    kind: "press",
    group: "axles",
    scs: "liftaxle",
    device: "semantical",
    verified: true,
    state: "slow.liftAxle",
    label: "Oś podnoszona",
  },
  "trailerLiftAxle.toggle": {
    kind: "press",
    group: "axles",
    scs: "liftaxlet",
    device: "semantical",
    verified: true,
    state: "slow.trailerLiftAxle",
    label: "Oś naczepy",
  },
  "trailer.toggle": {
    kind: "press",
    group: "trailer",
    scs: "attach",
    device: "semantical",
    verified: true,
    state: "slow.trailers",
    label: "Zaczep / odczep",
  },
  // ── Klakson ───────────────────────────────────────────────────────────────
  horn: { kind: "hold", group: "horn", scs: "horn", device: "semantical", verified: true, label: "Klakson" },
  airHorn: { kind: "hold", group: "horn", scs: "airhorn", device: "semantical", verified: true, label: "Pneumatyczny" },
  // ── Kamery ────────────────────────────────────────────────────────────────
  "camera.cycle": {
    kind: "press",
    group: "camera",
    scs: "camcycle",
    device: "semantical",
    verified: true,
    label: "Następna kamera",
  },
  "camera.1": { kind: "press", group: "camera", scs: "cam1", device: "semantical", verified: true, label: "Kabina" },
  "camera.2": {
    kind: "press",
    group: "camera",
    scs: "cam2",
    device: "semantical",
    verified: true,
    label: "Zewnętrzna",
  },
  "camera.3": { kind: "press", group: "camera", scs: "cam3", device: "semantical", verified: true, label: "Kamera 3" },
  "camera.4": { kind: "press", group: "camera", scs: "cam4", device: "semantical", verified: true, label: "Kamera 4" },
  "camera.5": { kind: "press", group: "camera", scs: "cam5", device: "semantical", verified: true, label: "Kamera 5" },
  "camera.6": { kind: "press", group: "camera", scs: "cam6", device: "semantical", verified: true, label: "Kamera 6" },
  "camera.7": { kind: "press", group: "camera", scs: "cam7", device: "semantical", verified: true, label: "Kamera 7" },
  "camera.8": { kind: "press", group: "camera", scs: "cam8", device: "semantical", verified: true, label: "Kamera 8" },
  // ── Radio w grze (stan stacji NIE jest w telemetrii — przyciski bez podświetlenia) ──
  "radio.toggle": {
    kind: "press",
    group: "radio",
    scs: "radio",
    device: "semantical",
    verified: true,
    label: "Okno radia",
  },
  "radio.play": {
    kind: "press",
    group: "radio",
    scs: "radiotoggle",
    device: "semantical",
    verified: true,
    label: "Radio graj/stop",
  },
  "radio.fav": {
    kind: "press",
    group: "radio",
    scs: "radiofav",
    device: "semantical",
    verified: true,
    label: "Ulubiona stacja",
  },
  "radio.next": {
    kind: "press",
    group: "radio",
    scs: "radionext",
    device: "semantical",
    verified: true,
    label: "Następna stacja",
  },
  "radio.prev": {
    kind: "press",
    group: "radio",
    scs: "radioprev",
    device: "semantical",
    verified: true,
    label: "Poprzednia stacja",
  },
  "radio.volUp": {
    kind: "press",
    group: "radio",
    scs: "radioup",
    device: "semantical",
    verified: true,
    label: "Głośniej",
  },
  "radio.volDown": {
    kind: "press",
    group: "radio",
    scs: "radiodown",
    device: "semantical",
    verified: true,
    label: "Ciszej",
  },
  // ── UI gry ────────────────────────────────────────────────────────────────
  "ui.map": { kind: "press", group: "ui", scs: "navmap", device: "semantical", verified: true, label: "Mapa" },
  "ui.advisorZoomIn": {
    kind: "press",
    group: "ui",
    scs: "advzoomin",
    device: "semantical",
    verified: true,
    label: "GPS przybliż",
  },
  "ui.advisorZoomOut": {
    kind: "press",
    group: "ui",
    scs: "advzoomout",
    device: "semantical",
    verified: true,
    label: "GPS oddal",
  },
  "ui.advisorEtaMode": {
    kind: "press",
    group: "ui",
    scs: "advetamode",
    device: "semantical",
    verified: true,
    label: "GPS tryb ETA",
  },
  "ui.hud": { kind: "press", group: "ui", scs: "showhud", device: "semantical", verified: true, label: "HUD" },
  "ui.mirrors": {
    kind: "press",
    group: "ui",
    scs: "showmirrors",
    device: "semantical",
    verified: true,
    label: "Lusterka",
  },
  "ui.screenshot": {
    kind: "press",
    group: "ui",
    scs: "screenshot",
    device: "semantical",
    verified: true,
    label: "Screenshot",
  },
  "ui.pause": { kind: "press", group: "ui", scs: "pause", device: "semantical", verified: true, label: "Pauza" },
  "ui.quickPark": {
    kind: "press",
    group: "ui",
    scs: "quickpark",
    device: "semantical",
    verified: true,
    label: "Quick park",
  },
} as const satisfies Record<string, ActionDef>;

export type ActionId = keyof typeof ACTIONS;
