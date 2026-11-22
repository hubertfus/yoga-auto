/**
 * Ekran „Pojazd” (DESIGN §6.3): wszystkie akcje z `ACTIONS` pogrupowane wg `group`.
 * Przycisk = `GlassButton` z `active` z telemetrii i `pending` z `commands`; akcje `set` jako segmenty;
 * akcje hold przez onHoldStart/End; niedostępne wyszarzone z tooltipem.
 */
import { useRef } from "react";
import { GlassSegmented, type SegmentOption } from "@yoga-auto/glass-ui";
import { ACTIONS, type ActionGroup, type ActionId } from "@yoga-auto/protocol";
import { registerScreen } from "../../core/registry.ts";
import { sendCmd, useOptimistic, usePending } from "../../core/commands.ts";
import { useConfig, useFast, useSlow, useStatus } from "../../core/store.ts";
import { ActionButton, useAvailability } from "../_shared/actions.tsx";
import { LightsModeControl } from "../lights/index.tsx";
import { InGameRadioControls } from "../radio/index.tsx";
import { formatSpeed, speedLabel, useUnits } from "../units/index.ts";

/** Kolejność i tytuły sekcji. Grupa spoza listy trafia na koniec jako „Inne”. */
export const GROUP_ORDER: readonly { group: ActionGroup; title: string }[] = [
  { group: "lights", title: "Światła" },
  { group: "signals", title: "Sygnały" },
  { group: "horn", title: "Klakson" },
  { group: "misc", title: "Wycieraczki" },
  { group: "drive", title: "Silnik" },
  { group: "brakes", title: "Hamulce" },
  { group: "cruise", title: "Tempomat" },
  { group: "axles", title: "Osie" },
  { group: "trailer", title: "Naczepa" },
  { group: "radio", title: "Radio w grze" },
  { group: "camera", title: "Kamera" },
  { group: "ui", title: "Gra" },
];

const ids = Object.keys(ACTIONS) as ActionId[];
/** Akcje danej grupy w kolejności katalogu. */
export const actionsOf = (group: ActionGroup): ActionId[] => ids.filter((id) => ACTIONS[id].group === group);

function SetSegments({ id, options, actual }: { id: ActionId; options: readonly SegmentOption<string>[]; actual: string }) {
  const value = useOptimistic<string>(id, actual);
  const pending = usePending(id);
  const { disabled, reason } = useAvailability(id);
  return (
    <div style={disabled ? { opacity: 0.4, pointerEvents: "none" } : undefined} title={reason ?? ACTIONS[id].label} className="ft-grow" data-action={id}>
      <GlassSegmented<string> options={options} value={value} pending={pending} onChange={(v) => void sendCmd(id, v, { optimistic: v })} />
    </div>
  );
}

function RetarderLevel() {
  const steps = useConfig((c) => c.truck?.retarderSteps ?? 0);
  const level = useFast((f) => f.retarder);
  const allowed = ACTIONS["retarder.level"].values.filter((v) => Number(v) <= Math.max(steps, 0));
  const options = allowed.map((v) => ({ value: v, label: v === "0" ? "Wył." : v }));
  return <SetSegments id="retarder.level" options={options} actual={String(level)} />;
}

function WipersLevel() {
  const on = useSlow((s) => s.wipers);
  const last = useRef("1");
  const optimistic = useOptimistic<string | null>("wipers.level", null);
  if (optimistic && optimistic !== "0") last.current = optimistic;
  const options = ACTIONS["wipers.level"].values.map((v) => ({ value: v, label: v === "0" ? "Wył." : v }));
  // Telemetria zna tylko wł./wył. — wł. pokazujemy jako ostatnio wybrany stopień.
  return <SetSegments id="wipers.level" options={options} actual={on ? last.current : "0"} />;
}

function CruiseValue() {
  const u = useUnits();
  const cruise = useFast((f) => f.cruise);
  return (
    <span className="ft-big" style={{ minWidth: 120, textAlign: "center", ...(cruise > 0.1 ? {} : { color: "var(--text-3)" }) }}>
      {cruise > 0.1 ? formatSpeed(cruise, u) : "–"}
      <small className="ft-unit">{speedLabel(u)}</small>
    </span>
  );
}

function SetControl({ id }: { id: ActionId }) {
  if (id === "lights.mode") return <LightsModeControl />;
  if (id === "retarder.level") return <RetarderLevel />;
  if (id === "wipers.level") return <WipersLevel />;
  return null;
}

function GroupActions({ group }: { group: ActionGroup }) {
  const list = actionsOf(group);
  const size = group === "camera" || group === "ui" || group === "radio" ? "md" : "lg";
  if (group === "radio") return <InGameRadioControls />;
  return (
    <>
      {list.map((id) =>
        ACTIONS[id].kind === "set" ? (
          <SetControl key={id} id={id} />
        ) : (
          <ActionButton key={id} id={id} size={size} {...(group === "camera" && id !== "camera.cycle" ? { label: ACTIONS[id].label.replace("Kamera ", "") } : {})} />
        ),
      )}
      {group === "cruise" ? <CruiseValue /> : null}
    </>
  );
}

export function VehicleScreen() {
  const status = useStatus();
  const known = new Set(GROUP_ORDER.map((g) => g.group));
  const extra = [...new Set(ids.map((id) => ACTIONS[id].group))].filter((g) => !known.has(g));
  const sections = [...GROUP_ORDER, ...extra.map((g) => ({ group: g, title: "Inne" }))];
  return (
    <div className="ft-screen" data-testid="vehicle-screen">
      {!status.inputEnabled ? (
        <div className="ft-dim" role="status">
          Sterowanie jest wyłączone w bridge — przyciski są nieaktywne.
        </div>
      ) : null}
      {sections.map(({ group, title }) => (
        <div className="ft-section" key={group} data-group={group}>
          <div className="ft-section__title">{title}</div>
          <div className="ft-section__body">
            <GroupActions group={group} />
          </div>
        </div>
      ))}
    </div>
  );
}

registerScreen({ id: "vehicle", label: "Pojazd", icon: "truck", order: 30, component: VehicleScreen });
