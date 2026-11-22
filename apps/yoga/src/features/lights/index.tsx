/** Widget świateł (segment wył./postojowe/mijania + drogowe + awaryjne) i kierunkowskazy z animacją z telemetrii. */
import { useRef } from "react";
import { GlassSegmented, Icon, type SegmentOption } from "@yoga-auto/glass-ui";
import { sendCmd, useOptimistic, usePending } from "../../core/commands.ts";
import { registerWidget } from "../../core/registry.ts";
import { useFast, useFastValue, useStatus } from "../../core/store.ts";
import { ActionButton } from "../_shared/actions.tsx";
import { CardTitle } from "../_shared/shared.tsx";

export type LightsMode = "off" | "parking" | "low";

export const LIGHTS_OPTIONS: readonly SegmentOption<LightsMode>[] = [
  { value: "off", label: "Wył." },
  { value: "parking", label: "Postoj." },
  { value: "low", label: "Mijania" },
];

/** Tryb świateł z telemetrii (drogowe liczą się jako mijania). */
export const lightsModeOf = (l: { parking: boolean; low: boolean }): LightsMode => (l.low ? "low" : l.parking ? "parking" : "off");

/** Segment trybu świateł: optymistyczny, `pending` z komend, wyszarzony przy wyłączonym sterowaniu. */
export function LightsModeControl() {
  const actual = useFast((f) => lightsModeOf(f.lights));
  const mode = useOptimistic<LightsMode>("lights.mode", actual);
  const pending = usePending("lights.mode");
  const inputEnabled = useStatus().inputEnabled;
  return (
    <div style={inputEnabled ? undefined : { opacity: 0.4, pointerEvents: "none" }} title={inputEnabled ? undefined : "Sterowanie wyłączone w bridge"}>
      <GlassSegmented<LightsMode>
        options={LIGHTS_OPTIONS}
        value={mode}
        pending={pending}
        onChange={(v) => void sendCmd("lights.mode", v, { optimistic: v })}
      />
    </div>
  );
}

/** Strzałka kierunkowskazu pulsująca zgodnie z żarówkami z telemetrii (bez re-renderu). */
export function BlinkerArrow({ side, size = 48 }: { side: "left" | "right"; size?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useFastValue(
    (f) => (side === "left" ? f.lights.blinkerLeftOn : f.lights.blinkerRightOn),
    (on) => ref.current?.setAttribute("data-on", String(on)),
  );
  return (
    <span ref={ref} className="ft-blinker" data-on="false" data-side={side} aria-label={side === "left" ? "Kierunkowskaz lewy" : "Kierunkowskaz prawy"}>
      <Icon name={side === "left" ? "blinker-left" : "blinker-right"} size={size} />
    </span>
  );
}

function LightsWidget() {
  return (
    <div className="ft-root">
      <CardTitle icon={<Icon name="lights-low" size={18} />}>Światła</CardTitle>
      <LightsModeControl />
      <div className="ft-grow" />
      <div className="ft-row">
        <ActionButton id="lights.high" size="md" icon="lights-high" showLabel={false} className="ft-grow" />
        <ActionButton id="lights.hazard" size="md" icon="hazard" showLabel={false} className="ft-grow" />
        <ActionButton id="lights.beacon" size="md" icon="beacon" showLabel={false} className="ft-grow" />
      </div>
    </div>
  );
}

registerWidget({ id: "lights", label: "Światła", size: "1x1", component: LightsWidget });
