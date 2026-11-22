/**
 * Radio w grze (akcje `radio.*`). Stan stacji/głośności nie jest w telemetrii, więc przyciski nie mają podświetlenia.
 * `InGameRadioControls` jest eksportowany — ekran `media` (S6) może go osadzić:
 *   import { InGameRadioControls } from "../radio/index.tsx";
 */
import { Icon } from "@yoga-auto/glass-ui";
import { registerWidget } from "../../core/registry.ts";
import { ActionButton } from "../_shared/actions.tsx";
import { CardTitle } from "../_shared/shared.tsx";

export function InGameRadioControls({ compact = false }: { compact?: boolean }) {
  const size = "md";
  return (
    <div className="ft-radio" style={{ display: "flex", flexWrap: "wrap", gap: "var(--s-3)", alignItems: "center" }} data-testid="ingame-radio">
      {compact ? null : <ActionButton id="radio.toggle" size={size} />}
      <ActionButton id="radio.prev" size={size} showLabel={!compact} label="Poprzednia" />
      <ActionButton id="radio.play" size={size} showLabel={!compact} label="Graj / stop" />
      <ActionButton id="radio.next" size={size} showLabel={!compact} label="Następna" />
      {compact ? null : <ActionButton id="radio.fav" size={size} label="Ulubiona" icon="check" />}
      <ActionButton id="radio.volDown" size={size} showLabel={!compact} label="Ciszej" />
      <ActionButton id="radio.volUp" size={size} showLabel={!compact} label="Głośniej" />
    </div>
  );
}

function RadioWidget() {
  return (
    <div className="ft-root">
      <CardTitle icon={<Icon name="radio" size={18} />}>Radio w grze</CardTitle>
      <div className="ft-grow" />
      <div className="ft-row">
        <ActionButton id="radio.prev" size="md" showLabel={false} className="ft-grow" />
        <ActionButton id="radio.play" size="md" showLabel={false} className="ft-grow" />
        <ActionButton id="radio.next" size="md" showLabel={false} className="ft-grow" />
      </div>
      <div className="ft-row">
        <ActionButton id="radio.volDown" size="md" showLabel={false} className="ft-grow" />
        <ActionButton id="radio.volUp" size="md" showLabel={false} className="ft-grow" />
      </div>
    </div>
  );
}

registerWidget({ id: "radio", label: "Radio w grze", size: "1x1", component: RadioWidget });
