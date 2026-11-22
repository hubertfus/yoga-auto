/**
 * F0: ekran diagnostyczny + surowy widget prędkości (dowód, że łańcuch mock → bridge → UI działa).
 * S5 może go zostawić jako ekran „Diagnostyka” albo usunąć, gdy będą prawdziwe widgety.
 */
import { useRef } from "react";
import { GlassButton, GlassPanel, Numeric, type ValueHandle } from "@yoga-auto/glass-ui";
import { ACTIONS, type ActionId } from "@yoga-auto/protocol";
import { holdEnd, holdStart, sendCmd, usePending } from "../../core/commands.ts";
import { registerScreen, registerWidget } from "../../core/registry.ts";
import { store, useConfig, useFast, useFastValue, useSlow, useStatus } from "../../core/store.ts";

function SpeedRaw() {
  const ref = useRef<ValueHandle>(null);
  useFastValue(
    (f) => f.speed * 3.6,
    (v) => ref.current?.setValue(v),
  );
  const limit = useSlow((s) => Math.round(s.nav.speedLimit * 3.6));
  const gear = useFast((f) => f.gear);
  return (
    <div>
      <div style={{ font: "var(--t-display)" }}>
        <Numeric ref={ref} />
        <span style={{ font: "var(--t-h2)", color: "var(--text-2)" }}> km/h</span>
      </div>
      <div style={{ color: "var(--text-2)" }}>
        bieg {gear} · limit {limit || "–"}
      </div>
    </div>
  );
}

function ActionButton({ id }: { id: ActionId }) {
  const def = ACTIONS[id];
  const pending = usePending(id);
  if (def.kind === "hold")
    return (
      <GlassButton
        size="lg"
        label={def.label}
        pending={pending}
        onHoldStart={() => void holdStart(id)}
        onHoldEnd={() => void holdEnd(id)}
      />
    );
  if (def.kind === "set") return null;
  return <GlassButton size="lg" label={def.label} pending={pending} onPress={() => void sendCmd(id)} />;
}

function DevScreen() {
  const status = useStatus();
  const job = useConfig((c) => c.job);
  const lights = useFast((f) => f.lights);
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <GlassPanel title="Status">
        <pre style={{ margin: 0, font: "var(--t-caption)" }}>
          {JSON.stringify({ status, lights, job: job && `${job.source.city} → ${job.destination.city}` }, null, 2)}
        </pre>
      </GlassPanel>
      <GlassPanel title="Akcje (surowe)">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          {(Object.keys(ACTIONS) as ActionId[]).map((id) => (
            <ActionButton key={id} id={id} />
          ))}
        </div>
      </GlassPanel>
      <GlassPanel title="Snapshot">
        <pre style={{ margin: 0, font: "var(--t-caption)", maxHeight: 400, overflow: "auto" }}>
          {JSON.stringify(store.state.slow, null, 2)}
        </pre>
      </GlassPanel>
    </div>
  );
}

registerWidget({ id: "speed", label: "Prędkość", size: "2x1", component: SpeedRaw, opens: "_dev" });
registerScreen({ id: "_dev", label: "Diagnostyka", icon: "bug", order: 999, component: DevScreen });
