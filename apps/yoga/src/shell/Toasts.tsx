/**
 * ToastHost shella: alerty (`alerts`), eventy (`event`) i porażki komend → stos toastów glass-ui.
 * Presentery (treść/ikony) dostarcza S5 przez registry; tu logika kolejki, deduplikacja, dźwięk.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ToastHost as GlassToastHost, type ToastProps } from "@yoga-auto/glass-ui";
import { useCommandFailures } from "../core/commands.ts";
import { getSettings } from "../core/settings.ts";
import { store, useAlerts, useGameEvents } from "../core/store.ts";
import { ACTIONS } from "@yoga-auto/protocol";
import { alertToToast, diffAlerts, eventToToast, failureToToast, type ToastModel } from "./toasts.ts";

const MAX_TOASTS = 3;
const FAILURE_DEDUPE_MS = 1500;

/** Krótki „bip” dla alertów krytycznych; ciche, jeśli przeglądarka nie pozwala na audio bez gestu. */
let audio: AudioContext | null = null;
export function beep(): void {
  if (!getSettings().sounds) return;
  try {
    audio ??= new AudioContext();
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.type = "sine";
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.2, audio.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.35);
    o.connect(g).connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + 0.4);
  } catch {
    /* brak audio */
  }
}

export function useToastQueue(): { toasts: ToastModel[]; push(t: ToastModel): void; dismiss(id: string): void } {
  const [toasts, setToasts] = useState<ToastModel[]>([]);

  const push = useCallback((t: ToastModel) => {
    setToasts((cur) => [...cur.filter((x) => x.id !== t.id), t].slice(-8));
    if (t.level === "critical") beep();
  }, []);
  const dismiss = useCallback((id: string) => setToasts((cur) => cur.filter((x) => x.id !== id)), []);

  // ─── alerty ───
  const alerts = useAlerts();
  const seen = useRef(new Set<string>());
  const prevIds = useRef(new Set<string>());
  useEffect(() => {
    const { fresh, clearedIds } = diffAlerts(seen.current, prevIds.current, alerts);
    for (const a of fresh) {
      seen.current.add(`${a.id}:${a.since}`);
      push(alertToToast(a));
    }
    if (clearedIds.length) setToasts((cur) => cur.filter((t) => !t.alertId || !clearedIds.includes(t.alertId)));
    prevIds.current = new Set(alerts.map((a) => a.id));
  }, [alerts, push]);

  // ─── eventy ───
  useGameEvents((e) => {
    const t = eventToToast(e);
    if (t) push(t);
  });

  // ─── porażki komend ───
  const lastFailure = useRef(new Map<string, number>());
  useCommandFailures(({ key, ack }) => {
    const now = Date.now();
    const k = `${key}:${ack.error}`;
    if (now - (lastFailure.current.get(k) ?? 0) < FAILURE_DEDUPE_MS) return;
    lastFailure.current.set(k, now);
    const label =
      key in ACTIONS ? ACTIONS[key as keyof typeof ACTIONS].label : key === "trip.reset" ? "Reset trasy" : key;
    push(failureToToast(label, ack.error, now));
  });

  // po zmianie sesji bridge'a pamięć „już pokazanych” jest nieaktualna
  useEffect(() => {
    let session = store.conn.session;
    return store.subscribe(() => {
      if (store.conn.session !== session) {
        session = store.conn.session;
        seen.current.clear();
      }
    });
  }, []);

  return { toasts, push, dismiss };
}

export function ToastHost() {
  const { toasts, dismiss } = useToastQueue();
  const props: ToastProps[] = useMemo(
    () =>
      toasts.map((t) => ({
        id: t.id,
        level: t.level,
        title: t.title,
        ...(t.body !== undefined ? { body: t.body } : {}),
        ...(t.icon !== undefined ? { icon: t.icon } : {}),
        duration: t.duration,
        onDismiss: dismiss,
      })),
    [toasts, dismiss],
  );
  return <GlassToastHost toasts={props} max={MAX_TOASTS} />;
}
