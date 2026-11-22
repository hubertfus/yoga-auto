/**
 * Rejestr ekranów, widgetów i prezenterów — kontrakt shell (S4) ↔ features (S5/S6/S8).
 * Każdy folder `src/features/<nazwa>/index.ts` jest ładowany automatycznie przez shell
 * (import.meta.glob), więc strumienie nie edytują wspólnego pliku.
 * Zmiany łamiące → docs/proposals/s4-*.md.
 */
import type { ComponentType, ReactNode } from "react";
import type { CardSize, ToastLevel } from "@yoga-auto/glass-ui";
import type { Alert, AlertCode, GameEvent, GameEventKind } from "@yoga-auto/protocol";

export interface ScreenDef {
  id: string;
  label: string;
  /** nazwa ikony dla <Icon name> */
  icon: string;
  /** kolejność w docku (mniejsza = wyżej) */
  order: number;
  component: ComponentType;
  /** false = ekran dostępny tylko z kodu (np. ustawienia szczegółowe) */
  dock?: boolean;
}

export interface WidgetProps {
  size: CardSize;
}

export interface WidgetDef {
  id: string;
  label: string;
  /** rozmiar domyślny na Home */
  size: CardSize;
  /** dozwolone rozmiary (edytor układu, M4) */
  sizes?: readonly CardSize[];
  component: ComponentType<WidgetProps>;
  /** id ekranu otwieranego po tapnięciu */
  opens?: string;
}

export interface ToastContent {
  title: ReactNode;
  body?: ReactNode;
  icon?: ReactNode;
  level?: ToastLevel;
  /** ms; 0 = trwały (dla alertów sticky) */
  duration?: number;
}

export type AlertPresenter = (alert: Alert) => ToastContent;
export type EventPresenter<K extends GameEventKind = GameEventKind> = (
  event: Extract<GameEvent, { kind: K }>,
) => ToastContent | null;

export interface StatusItemDef {
  id: string;
  side: "left" | "center" | "right";
  order: number;
  component: ComponentType;
}

const screens = new Map<string, ScreenDef>();
const widgets = new Map<string, WidgetDef>();
const alertPresenters = new Map<AlertCode, AlertPresenter>();
const eventPresenters = new Map<GameEventKind, EventPresenter>();
const statusItems = new Map<string, StatusItemDef>();

export const registerScreen = (def: ScreenDef): void => void screens.set(def.id, def);
export const registerWidget = (def: WidgetDef): void => void widgets.set(def.id, def);
export const registerAlertPresenter = (code: AlertCode, p: AlertPresenter): void => void alertPresenters.set(code, p);
export const registerEventPresenter = <K extends GameEventKind>(kind: K, p: EventPresenter<K>): void =>
  void eventPresenters.set(kind, p as unknown as EventPresenter);
export const registerStatusItem = (def: StatusItemDef): void => void statusItems.set(def.id, def);

export const getScreens = (): ScreenDef[] => [...screens.values()].sort((a, b) => a.order - b.order);
export const getScreen = (id: string): ScreenDef | undefined => screens.get(id);
export const getWidgets = (): WidgetDef[] => [...widgets.values()];
export const getWidget = (id: string): WidgetDef | undefined => widgets.get(id);
export const getAlertPresenter = (code: AlertCode): AlertPresenter | undefined => alertPresenters.get(code);
export const getEventPresenter = (kind: GameEventKind): EventPresenter | undefined => eventPresenters.get(kind);
export const getStatusItems = (side: StatusItemDef["side"]): StatusItemDef[] =>
  [...statusItems.values()].filter((s) => s.side === side).sort((a, b) => a.order - b.order);

/** Domyślny układ Home (siatka 6×3: mapa 2×2, zegary, nawigacja, skróty w dolnym rzędzie). Id widgetów, których nie ma w rejestrze, są pomijane. */
export const DEFAULT_HOME_LAYOUT: readonly string[] = [
  "map",
  "speed",
  "nav",
  "job",
  "media",
  "lights",
  "sc.hazard",
  "sc.parkingBrake",
  "sc.engine",
  "sc.beacon",
  "sc.high",
  "sc.trip",
  "cruise",
];
