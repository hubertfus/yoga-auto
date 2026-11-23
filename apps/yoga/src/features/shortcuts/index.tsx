/**
 * Skróty na Home: małe kafle 1×1 z jedną akcją pojazdu (tap = komenda) albo z przejściem do ekranu.
 * Każdy skrót to osobny widget (`sc.*`), więc w edytorze układu można je dowolnie dokładać/usuwać/przestawiać.
 */
import { Icon } from "@yoga-auto/glass-ui";
import { ACTIONS, type ActionId } from "@yoga-auto/protocol";
import { registerWidget } from "../../core/registry.ts";
import { ActionButton } from "../_shared/actions.tsx";
import "./shortcuts.css";

interface ActionShortcut {
  id: string;
  action: ActionId;
  label: string;
  icon?: string;
}

interface ScreenShortcut {
  id: string;
  screen: string;
  label: string;
  icon: string;
}

export const ACTION_SHORTCUTS: readonly ActionShortcut[] = [
  { id: "sc.hazard", action: "lights.hazard", label: "Awaryjne" },
  { id: "sc.parkingBrake", action: "parkingBrake.toggle", label: "Ręczny" },
  { id: "sc.engine", action: "engine.toggle", label: "Silnik" },
  { id: "sc.beacon", action: "lights.beacon", label: "Kogut" },
  { id: "sc.high", action: "lights.high", label: "Drogowe" },
  { id: "sc.horn", action: "airHorn", label: "Trąbka" },
  { id: "sc.motorBrake", action: "motorBrake.toggle", label: "Hamulec silnik." },
  { id: "sc.diffLock", action: "diffLock.toggle", label: "Blokada" },
  { id: "sc.trailer", action: "trailer.toggle", label: "Naczepa" },
  { id: "sc.wipers", action: "wipers.up", label: "Wycieraczki" },
  { id: "sc.camera", action: "camera.cycle", label: "Kamera" },
  { id: "sc.gameMap", action: "ui.map", label: "Mapa w grze" },
  { id: "sc.screenshot", action: "ui.screenshot", label: "Zrzut" },
];

export const SCREEN_SHORTCUTS: readonly ScreenShortcut[] = [
  { id: "sc.trip", screen: "trip", label: "Komputer", icon: "activity" },
  { id: "sc.vehicle", screen: "vehicle", label: "Pojazd", icon: "truck" },
  { id: "sc.jobs", screen: "jobs", label: "Zlecenia", icon: "cargo" },
  { id: "sc.mapScreen", screen: "map", label: "Mapa", icon: "map" },
  { id: "sc.settings", screen: "settings", label: "Ustawienia", icon: "settings" },
];

function makeActionTile(s: ActionShortcut) {
  function ActionTile() {
    return (
      // cały kafel jest przyciskiem (wcześniej reagowało tylko kółko w środku)
      <div className="sc-tile sc-tile--action">
        <ActionButton id={s.action} size="xl" label={s.label} {...(s.icon ? { icon: s.icon } : {})} className="sc-tile__btn" />
      </div>
    );
  }
  ActionTile.displayName = `Shortcut(${s.id})`;
  return ActionTile;
}

function makeScreenTile(s: ScreenShortcut) {
  function ScreenTile() {
    return (
      <div className="sc-tile">
        <span className="sc-tile__icon">
          <Icon name={s.icon} size={40} />
        </span>
        <span className="sc-tile__label">{s.label}</span>
      </div>
    );
  }
  ScreenTile.displayName = `Shortcut(${s.id})`;
  return ScreenTile;
}

for (const s of ACTION_SHORTCUTS) {
  if (!ACTIONS[s.action]) continue;
  registerWidget({ id: s.id, label: `Skrót: ${s.label}`, size: "1x1", sizes: ["1x1"], component: makeActionTile(s) });
}
for (const s of SCREEN_SHORTCUTS) {
  registerWidget({
    id: s.id,
    label: `Skrót: ${s.label}`,
    size: "1x1",
    sizes: ["1x1"],
    component: makeScreenTile(s),
    opens: s.screen,
  });
}
