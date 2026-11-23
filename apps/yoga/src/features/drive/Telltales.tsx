/**
 * Pasek kontrolek jak w zestawie wskaźników: zgaszone widoczne blado, zapalone w kolorze wg konwencji
 * (zielone: działa, niebieskie: drogowe, bursztynowe: uwaga/układy, czerwone: awaria lub zaciągnięty ręczny).
 */
import { Icon } from "@yoga-auto/glass-ui";
import type { FastState, SlowState } from "@yoga-auto/protocol";
import { useFast, useSlow } from "../../core/store.ts";

export type TelltaleTone = "on" | "blue" | "amber" | "red";

export interface TelltaleDef {
  id: string;
  icon: string;
  label: string;
  tone: TelltaleTone;
  fast?: (f: FastState) => boolean;
  slow?: (s: SlowState) => boolean;
}

/** Kolejność od lewej: kierunkowskaz, światła, układy jazdy, ostrzeżenia, kierunkowskaz. */
export const TELLTALES: readonly TelltaleDef[] = [
  { id: "blinker-left", icon: "blinker-left", label: "Kierunkowskaz lewy", tone: "on", fast: (f) => f.lights.blinkerLeftOn },
  { id: "parking", icon: "lights-parking", label: "Światła pozycyjne", tone: "on", fast: (f) => f.lights.parking },
  { id: "low", icon: "lights-low", label: "Światła mijania", tone: "on", fast: (f) => f.lights.low },
  { id: "high", icon: "lights-high", label: "Światła drogowe", tone: "blue", fast: (f) => f.lights.high },
  { id: "beacon", icon: "beacon", label: "Kogut", tone: "amber", fast: (f) => f.lights.beacon },
  { id: "cruise", icon: "cruise", label: "Tempomat", tone: "on", fast: (f) => f.cruise > 0.1 },
  { id: "motor-brake", icon: "engine-brake", label: "Hamulec silnikowy", tone: "amber", fast: (f) => f.motorBrake },
  { id: "retarder", icon: "retarder", label: "Retarder", tone: "amber", fast: (f) => f.retarder > 0 },
  { id: "diff-lock", icon: "diff-lock", label: "Blokada mechanizmu różnicowego", tone: "amber", slow: (s) => s.diffLock },
  { id: "lift-axle", icon: "lift-axle", label: "Oś podnoszona", tone: "amber", slow: (s) => s.liftAxle || s.trailerLiftAxle },
  { id: "engine", icon: "ignition", label: "Silnik wyłączony (zapłon)", tone: "amber", fast: (f) => f.electricOn && !f.engineOn },
  { id: "fuel", icon: "fuel", label: "Rezerwa paliwa", tone: "amber", slow: (s) => s.fuel.warning },
  { id: "adblue", icon: "adblue", label: "Niski poziom AdBlue", tone: "amber", slow: (s) => s.adblue.warning },
  { id: "battery", icon: "battery", label: "Ładowanie akumulatora", tone: "red", slow: (s) => s.battery.warning },
  { id: "oil", icon: "oil", label: "Ciśnienie oleju", tone: "red", slow: (s) => s.oilPressure.warning },
  { id: "water", icon: "thermometer", label: "Temperatura płynu chłodzącego", tone: "red", slow: (s) => s.waterTempWarning },
  { id: "air", icon: "air", label: "Ciśnienie powietrza", tone: "red", slow: (s) => s.air.warning || s.air.emergency },
  { id: "parking-brake", icon: "parking-brake", label: "Hamulec postojowy", tone: "red", fast: (f) => f.parkingBrake },
  { id: "blinker-right", icon: "blinker-right", label: "Kierunkowskaz prawy", tone: "on", fast: (f) => f.lights.blinkerRightOn },
];

const never = () => false;

function Telltale({ def }: { def: TelltaleDef }) {
  const fastOn = useFast(def.fast ?? never);
  const slowOn = useSlow(def.slow ?? never);
  const on = fastOn || slowOn;
  const blinker = def.id.startsWith("blinker");
  return (
    <span
      className="tt"
      data-tone={def.tone}
      data-on={on || undefined}
      data-blinker={blinker || undefined}
      role="img"
      aria-label={`${def.label}: ${on ? "wł." : "wył."}`}
      title={def.label}
      data-testid={`tt-${def.id}`}
    >
      <Icon name={def.icon} size={blinker ? 34 : 26} />
    </span>
  );
}

export function Telltales() {
  return (
    <div className="dr-tt" data-testid="drive-telltales">
      {TELLTALES.map((d) => (
        <Telltale key={d.id} def={d} />
      ))}
    </div>
  );
}
