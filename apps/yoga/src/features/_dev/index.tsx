/**
 * Ekran diagnostyczny (surowe akcje, status, snapshot). Widget `speed` przejął S5 (features/gauges).
 */
import { GlassButton, GlassPanel } from "@yoga-auto/glass-ui";
import { ACTIONS, type ActionId } from "@yoga-auto/protocol";
import { holdEnd, holdStart, sendCmd, usePending } from "../../core/commands.ts";
import { registerScreen } from "../../core/registry.ts";
import { store, useConfig, useFast, useStatus } from "../../core/store.ts";

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
      {job?.bus ? (
        <GlassPanel title="Kurs autobusowy: surowe atrybuty bus_job">
          <pre style={{ margin: 0, font: "var(--t-caption)", maxHeight: 300, overflow: "auto" }} data-testid="dev-bus-raw">
            {JSON.stringify(job.bus.raw, null, 2)}
          </pre>
        </GlassPanel>
      ) : null}
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

registerScreen({ id: "_dev", label: "Diagnostyka", icon: "bug", order: 999, component: DevScreen });
