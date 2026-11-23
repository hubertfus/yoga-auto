/** Arkusz „Dostosuj ekran”: elementy, skala prędkościomierza, pola panelu trasy, małe zegary, przyciski na dole. */
import { GlassButton, GlassSegmented, GlassToggle, Icon, Sheet } from "@yoga-auto/glass-ui";
import { ACTIONS } from "@yoga-auto/protocol";
import { ACTION_ICONS } from "../_shared/actions.tsx";
import { useUnits } from "../units/index.ts";
import { speedRangeLabel } from "./dial.ts";
import {
  ACTION_CHOICES,
  FACTS,
  GAUGES,
  resetDriveLayout,
  toggleLayoutItem,
  updateDriveLayout,
  useDriveLayout,
  type SpeedRange,
} from "./layout.ts";

export function CustomizeSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const l = useDriveLayout();
  const u = useUnits();
  const ranges: SpeedRange[] = ["low", "mid", "high"];
  return (
    <Sheet open={open} onClose={onClose} title="Dostosuj ekran Jazda" detents={["large"]}>
      <div className="drc" data-testid="drive-customize">
        <section>
          <h3>Elementy</h3>
          <div className="drc-toggles">
            <GlassToggle label="Pasek kontrolek" checked={l.telltales} onChange={(v) => updateDriveLayout({ telltales: v })} />
            <GlassToggle label="Panel trasy (środek)" checked={l.panel} onChange={(v) => updateDriveLayout({ panel: v })} />
          </div>
        </section>
        <section>
          <h3>Skala prędkościomierza</h3>
          <GlassSegmented
            options={ranges.map((r) => ({ value: r, label: speedRangeLabel(u, r) }))}
            value={l.speedRange}
            onChange={(v) => updateDriveLayout({ speedRange: v })}
          />
        </section>
        <section data-disabled={!l.panel || undefined}>
          <h3>Panel trasy</h3>
          <div className="drc-chips">
            {FACTS.map((f) => (
              <GlassButton
                key={f.id}
                size="md"
                label={f.label}
                active={l.facts.includes(f.id)}
                disabled={!l.panel}
                onPress={() => toggleLayoutItem("facts", f.id)}
                data-testid={`drc-fact-${f.id}`}
              />
            ))}
          </div>
        </section>
        <section>
          <h3>Małe zegary</h3>
          <div className="drc-chips">
            {GAUGES.map((g) => (
              <GlassButton
                key={g.id}
                size="md"
                label={g.label}
                active={l.gauges.includes(g.id)}
                onPress={() => toggleLayoutItem("gauges", g.id)}
                data-testid={`drc-gauge-${g.id}`}
              />
            ))}
          </div>
        </section>
        <section>
          <h3>Przyciski na dole</h3>
          <p className="drc-hint">Kolejność jak dodajesz. Bez wybranych przycisków pasek znika.</p>
          <div className="drc-chips">
            {ACTION_CHOICES.map((a) => (
              <GlassButton
                key={a}
                size="md"
                icon={<Icon name={ACTION_ICONS[a] ?? "zap"} />}
                label={ACTIONS[a].label}
                active={l.actions.includes(a)}
                onPress={() => toggleLayoutItem("actions", a)}
                data-testid={`drc-action-${a}`}
              />
            ))}
          </div>
        </section>
        <div className="drc-foot">
          <GlassButton size="md" label="Przywróć domyślne" onPress={resetDriveLayout} />
          <GlassButton size="md" variant="filled" label="Gotowe" onPress={onClose} />
        </div>
      </div>
    </Sheet>
  );
}
