/**
 * Przyciski akcji pojazdu: `GlassButton` z `active` z telemetrii, `pending` z `commands`,
 * optymistycznym `sendCmd` (rollback przy ok:false robi CommandBus), hold przez onHoldStart/End,
 * wyszarzeniem akcji niedostępnych (bridge bez inputu, not_supported, verified:false).
 */
import { useSyncExternalStore } from "react";
import { GlassButton, Icon, type Tone } from "@yoga-auto/glass-ui";
import { ACTIONS, type ActionId, type FastState, type SlowState } from "@yoga-auto/protocol";
import { commands, holdEnd, holdStart, sendCmd, useOptimistic, usePending } from "../../core/commands.ts";
import { store, useFast, useSlow, useStatus } from "../../core/store.ts";

// ─── stan przycisku z telemetrii (czyste funkcje, testowane) ───

/** Czy akcja ma być podświetlona wg kanału fast. Akcje bez `state` → false. */
export function fastActive(id: ActionId, f: FastState): boolean {
  switch (id) {
    case "lights.off":
      return !f.lights.parking && !f.lights.low;
    case "lights.high":
      return f.lights.high;
    case "lights.beacon":
      return f.lights.beacon;
    case "lights.hazard":
      return f.hazard;
    case "blinker.left":
    case "blinker.leftHold":
      return f.blinker === "left";
    case "blinker.right":
    case "blinker.rightHold":
      return f.blinker === "right";
    case "engine.toggle":
      return f.engineOn;
    case "electric.toggle":
      return f.electricOn;
    case "parkingBrake.toggle":
      return f.parkingBrake;
    case "motorBrake.toggle":
      return f.motorBrake;
    case "retarder.up":
    case "retarder.down":
      return f.retarder > 0;
    case "cruise.set":
    case "cruise.resume":
    case "cruise.inc":
    case "cruise.dec":
      return f.cruise > 0.1;
    default:
      return false;
  }
}

/** Jak wyżej dla kanału slow. */
export function slowActive(id: ActionId, s: SlowState): boolean {
  switch (id) {
    case "diffLock.toggle":
      return s.diffLock;
    case "liftAxle.toggle":
      return s.liftAxle;
    case "trailerLiftAxle.toggle":
      return s.trailerLiftAxle;
    case "trailer.toggle":
      return s.trailers.some((t) => t.connected);
    case "wipers.up":
    case "wipers.down":
      return s.wipers;
    default:
      return false;
  }
}

/** Akcje, których sam wciśnięcie przewidywalnie przełącza stan → optymistyczne `!active`. */
const OPTIMISTIC_TOGGLES: ReadonlySet<ActionId> = new Set<ActionId>([
  "lights.high",
  "lights.beacon",
  "lights.hazard",
  "blinker.left",
  "blinker.right",
  "engine.toggle",
  "electric.toggle",
  "parkingBrake.toggle",
  "motorBrake.toggle",
  "diffLock.toggle",
  "liftAxle.toggle",
  "trailerLiftAxle.toggle",
]);
/** Optymizm tylko tam, gdzie wynik jest przewidywalny (drogowe działają wyłącznie przy włączonych mijania). */
export const isOptimisticToggle = (id: ActionId, f: FastState = store.state.fast): boolean =>
  OPTIMISTIC_TOGGLES.has(id) && (id !== "lights.high" || f.lights.low);

// ─── akcje niedostępne ───

const unsupported = new Set<string>();
const unsupportedListeners = new Set<() => void>();
let unsupportedVersion = 0;
commands.onFailure((f) => {
  if (f.ack.error === "not_supported" && !unsupported.has(f.key)) {
    unsupported.add(f.key);
    unsupportedVersion++;
    unsupportedListeners.forEach((l) => l());
  }
});
const subscribeUnsupported = (l: () => void) => {
  unsupportedListeners.add(l);
  return () => unsupportedListeners.delete(l);
};
/** Test / reset. */
export const resetUnsupported = (): void => {
  unsupported.clear();
  unsupportedVersion++;
  unsupportedListeners.forEach((l) => l());
};

export interface Availability {
  disabled: boolean;
  /** tooltip wyjaśniający wyszarzenie */
  reason?: string;
}

export function availability(
  id: ActionId,
  ctx: { inputEnabled: boolean; unsupported: boolean },
): Availability {
  const def = ACTIONS[id];
  if (!ctx.inputEnabled) return { disabled: true, reason: "Sterowanie wyłączone w bridge" };
  if (ctx.unsupported) return { disabled: true, reason: "Niedostępne: wejście nie jest zarejestrowane w grze" };
  if (!def.verified) return { disabled: true, reason: "Nieprzetestowane w grze" };
  return { disabled: false };
}

export function useAvailability(id: ActionId): Availability {
  const inputEnabled = useStatus().inputEnabled;
  const isUnsupported = useSyncExternalStore(
    subscribeUnsupported,
    () => unsupportedVersion,
  );
  void isUnsupported;
  return availability(id, { inputEnabled, unsupported: unsupported.has(id) });
}

// ─── ikony ───

export const ACTION_ICONS: Partial<Record<ActionId, string>> = {
  "lights.cycle": "lightbulb",
  "lights.off": "lightbulb-off",
  "lights.high": "lights-high",
  "lights.flash": "lights-high",
  "lights.beacon": "beacon",
  "lights.hazard": "hazard",
  "blinker.left": "blinker-left",
  "blinker.right": "blinker-right",
  "blinker.leftHold": "blinker-left",
  "blinker.rightHold": "blinker-right",
  "wipers.up": "wipers",
  "wipers.down": "wipers",
  "engine.toggle": "power",
  "electric.toggle": "ignition",
  "parkingBrake.toggle": "parking-brake",
  "motorBrake.toggle": "engine-brake",
  "retarder.up": "retarder",
  "retarder.down": "retarder",
  "cruise.set": "cruise",
  "cruise.inc": "plus",
  "cruise.dec": "minus",
  "cruise.resume": "cruise",
  "diffLock.toggle": "diff-lock",
  "liftAxle.toggle": "lift-axle",
  "trailerLiftAxle.toggle": "lift-axle",
  "trailer.toggle": "coupling",
  horn: "horn",
  airHorn: "horn",
  "camera.cycle": "camera",
  "radio.toggle": "radio",
  "radio.play": "play",
  "radio.fav": "check",
  "radio.next": "skip-forward",
  "radio.prev": "skip-back",
  "radio.volUp": "volume-2",
  "radio.volDown": "volume",
  "ui.map": "map",
  "ui.advisorZoomIn": "plus",
  "ui.advisorZoomOut": "minus",
  "ui.advisorEtaMode": "clock",
  "ui.hud": "monitor",
  "ui.mirrors": "eye",
  "ui.screenshot": "image",
  "ui.pause": "pause",
  "ui.quickPark": "parking-brake",
};

const TONES: Partial<Record<ActionId, Tone>> = {
  "lights.cycle": "lights",
  "lights.off": "lights",
  "lights.high": "beam",
  "lights.beacon": "warn",
  "lights.hazard": "warn",
  "blinker.left": "on",
  "blinker.right": "on",
  "blinker.leftHold": "on",
  "blinker.rightHold": "on",
  "parkingBrake.toggle": "crit",
  "engine.toggle": "on",
  "electric.toggle": "on",
  "cruise.set": "on",
};

// ─── przycisk ───

export interface ActionButtonProps {
  id: ActionId;
  size?: "sm" | "md" | "lg" | "xl";
  /** nadpisanie etykiety (domyślnie `ACTIONS[id].label`) */
  label?: string;
  /** `false` = tylko ikona */
  showLabel?: boolean;
  /** nazwa ikony, `false` = bez ikony */
  icon?: string | false;
  className?: string;
}

/** Przycisk akcji `press` / `hold`. Akcje `set` mają osobne kontrolki (segmenty). */
export function ActionButton({ id, size = "lg", label, showLabel = true, icon, className }: ActionButtonProps) {
  const def = ACTIONS[id];
  const pending = usePending(id);
  const fActive = useFast((f) => fastActive(id, f));
  const sActive = useSlow((s) => slowActive(id, s));
  const actual = fActive || sActive;
  const active = useOptimistic<boolean>(id, actual);
  const { disabled, reason } = useAvailability(id);
  const text = label ?? def.label;
  const iconName = icon === false ? undefined : (icon ?? ACTION_ICONS[id]);
  const common = {
    size,
    ...(iconName ? { icon: <Icon name={iconName} /> } : {}),
    ...(showLabel ? { label: text } : {}),
    active,
    pending,
    disabled,
    tone: TONES[id] ?? ("accent" as Tone),
    title: reason ?? text,
    "aria-label": text,
    "data-action": id,
    ...(className ? { className } : {}),
  };
  if (def.kind === "hold") {
    return <GlassButton {...common} onHoldStart={() => void holdStart(id)} onHoldEnd={() => void holdEnd(id)} />;
  }
  return (
    <GlassButton
      {...common}
      onPress={() => void sendCmd(id, undefined, isOptimisticToggle(id) ? { optimistic: !actual } : undefined)}
    />
  );
}
