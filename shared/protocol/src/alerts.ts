/** Alerty wyliczane przez bridge (reguły w docs/ANALYSIS.md §5.3). */

export type AlertLevel = "info" | "warning" | "critical";

export type AlertCode =
  | "fuel.low"
  | "adblue.low"
  | "air.low"
  | "air.emergency"
  | "oil.pressure"
  | "water.temp"
  | "battery.voltage"
  | "damage.hit"
  | "damage.high"
  | "rest.soon"
  | "rest.now"
  | "rest.overdue"
  | "speeding"
  | "job.late"
  | "game.disconnected";

export interface Alert {
  /** stabilne id instancji (np. "speeding" lub "damage.hit:1732291200000") */
  id: string;
  code: AlertCode;
  level: AlertLevel;
  /** ms epoch bridge'a */
  since: number;
  /** dane do treści, np. { limit: 22.2, speed: 25.1 } albo { part: "engine", delta: 0.04 } */
  data?: Record<string, number | string | boolean>;
  /** alert jednorazowy (toast) vs trwały (wisi, dopóki warunek trwa) */
  sticky: boolean;
}
