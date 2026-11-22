/**
 * Mapowanie alertów / eventów / porażek komend na toasty (czysta logika, bez Reacta — testowalna).
 * Treść i ikony dostarcza S5 przez `registerAlertPresenter` / `registerEventPresenter`;
 * tu są tylko bezpieczne wartości domyślne dla kodów bez prezentera.
 */
import type { ReactNode } from "react";
import type { ToastLevel } from "@yoga-auto/glass-ui";
import type { AckError, Alert, AlertCode, GameEvent } from "@yoga-auto/protocol";
import { getAlertPresenter, getEventPresenter, type ToastContent } from "../core/registry.ts";

export interface ToastModel {
  id: string;
  level: ToastLevel;
  title: ReactNode;
  body?: ReactNode;
  icon?: ReactNode;
  /** ms; 0 = do odwołania */
  duration: number;
  /** id alertu, jeśli toast jest powiązany z trwałym alertem (znika razem z nim) */
  alertId?: string;
}

export const DEFAULT_TOAST_MS = 5000;
export const CRITICAL_TOAST_MS = 8000;

const ALERT_TITLES: Partial<Record<AlertCode, string>> = {
  "fuel.low": "Niski poziom paliwa",
  "adblue.low": "Niski poziom AdBlue",
  "air.low": "Niskie ciśnienie powietrza",
  "air.emergency": "Ciśnienie powietrza krytyczne",
  "oil.pressure": "Niskie ciśnienie oleju",
  "water.temp": "Wysoka temperatura silnika",
  "battery.voltage": "Niskie napięcie akumulatora",
  "damage.hit": "Uderzenie",
  "damage.high": "Poważne uszkodzenia",
  "rest.soon": "Zbliża się odpoczynek",
  "rest.now": "Czas na odpoczynek",
  "rest.overdue": "Przekroczony czas jazdy",
  speeding: "Przekroczenie prędkości",
  "job.late": "Spóźnienie z dostawą",
  "game.disconnected": "Brak połączenia z grą",
};

/** Tytuł alertu: z prezentera (S5), inaczej domyślny polski, inaczej surowy kod (zgodność w przód). */
export function alertTitle(alert: Alert): ReactNode {
  return getAlertPresenter(alert.code)?.(alert).title ?? ALERT_TITLES[alert.code] ?? alert.code;
}

export function alertToToast(alert: Alert): ToastModel {
  const content: ToastContent | undefined = getAlertPresenter(alert.code)?.(alert);
  const level = content?.level ?? alert.level;
  const duration = content?.duration ?? (level === "critical" ? CRITICAL_TOAST_MS : DEFAULT_TOAST_MS);
  return {
    id: `alert:${alert.id}:${alert.since}`,
    alertId: alert.id,
    level,
    title: content?.title ?? ALERT_TITLES[alert.code] ?? alert.code,
    body: content?.body,
    icon: content?.icon,
    // alert trwały wisi, dopóki warunek trwa (znika wraz z `cleared`)
    duration: alert.sticky ? 0 : duration,
  };
}

export function eventToToast(event: GameEvent, now = Date.now()): ToastModel | null {
  const content = getEventPresenter(event.kind)?.(event as never);
  if (!content) return null;
  return {
    id: `event:${event.kind}:${now}`,
    level: content.level ?? "info",
    title: content.title,
    body: content.body,
    icon: content.icon,
    duration: content.duration ?? DEFAULT_TOAST_MS,
  };
}

const ACK_TEXT: Record<AckError, string> = {
  unknown_action: "Nieznana akcja",
  input_disabled: "Sterowanie grą jest wyłączone",
  game_not_connected: "Gra nie działa",
  game_paused: "Gra jest spauzowana",
  invalid_value: "Niedozwolona wartość",
  timeout: "Brak odpowiedzi gry",
  rate_limited: "Za dużo komend — zwolnij",
  not_supported: "Gra nie obsługuje tej akcji",
};

export function ackErrorText(error: AckError | undefined): string {
  return (error && ACK_TEXT[error]) || "Nie udało się wykonać polecenia";
}

export function failureToToast(label: string, error: AckError | undefined, now = Date.now()): ToastModel {
  return {
    id: `cmd:${label}:${now}`,
    level: "warning",
    title: `Nie wykonano: ${label}`,
    body: ackErrorText(error),
    duration: 3500,
  };
}

/** Które alerty są nowe względem zbioru już pokazanych (klucz id+since) i które id zniknęły. */
export function diffAlerts(
  seen: ReadonlySet<string>,
  prevIds: ReadonlySet<string>,
  alerts: readonly Alert[],
): { fresh: Alert[]; clearedIds: string[] } {
  const ids = new Set(alerts.map((a) => a.id));
  return {
    fresh: alerts.filter((a) => !seen.has(`${a.id}:${a.since}`)),
    clearedIds: [...prevIds].filter((id) => !ids.has(id)),
  };
}

const RANK: Record<string, number> = { critical: 3, warning: 2, info: 1 };
const rank = (a: Alert) => RANK[a.level] ?? 0;

/** Najpoważniejszy trwały alert (do środka paska stanu); przy remisie — najświeższy. */
export function topAlert(alerts: readonly Alert[]): Alert | null {
  let best: Alert | null = null;
  for (const a of alerts) {
    if (!a.sticky) continue;
    if (!best || rank(a) > rank(best) || (rank(a) === rank(best) && a.since > best.since)) best = a;
  }
  return best;
}
