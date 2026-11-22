/**
 * Wysyłanie komend pojazdu i mediów. Stan `pending` dla przycisków, hold z `keep`.
 * Właściciel po F0: S4.
 */
import { useSyncExternalStore } from "react";
import type { AckMsg, ActionId, MediaAction } from "@yoga-auto/protocol";
import { client } from "./client.ts";

const ACK_TIMEOUT_MS = 2000;
const KEEP_INTERVAL_MS = 1000;

let nextId = 1;
const pendingById = new Map<
  string,
  { action: string; resolve(a: AckMsg): void; timer: ReturnType<typeof setTimeout> }
>();
const pendingActions = new Map<string, number>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

client.onMessage((msg) => {
  if (msg.t !== "ack") return;
  const p = pendingById.get(msg.id);
  if (!p) return;
  clearTimeout(p.timer);
  pendingById.delete(msg.id);
  dec(p.action);
  p.resolve(msg);
});

function inc(a: string) {
  pendingActions.set(a, (pendingActions.get(a) ?? 0) + 1);
  notify();
}

function dec(a: string) {
  const n = (pendingActions.get(a) ?? 1) - 1;
  if (n <= 0) pendingActions.delete(a);
  else pendingActions.set(a, n);
  notify();
}

function track(id: string, key: string, sent: boolean): Promise<AckMsg> {
  if (!sent) return Promise.resolve({ t: "ack", id, ok: false, error: "game_not_connected", tookMs: 0 });
  inc(key);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingById.delete(id);
      dec(key);
      resolve({ t: "ack", id, ok: false, error: "timeout", tookMs: ACK_TIMEOUT_MS });
    }, ACK_TIMEOUT_MS);
    pendingById.set(id, { action: key, resolve, timer });
  });
}

/** Akcja press / set. */
export function sendCmd(action: ActionId, value?: string): Promise<AckMsg> {
  const id = `c${nextId++}`;
  const sent = client.send({ t: "cmd", id, action, ...(value !== undefined ? { value } : {}) });
  return track(id, action, sent);
}

const keepTimers = new Map<string, ReturnType<typeof setInterval>>();

/** Akcja hold: start. */
export function holdStart(action: ActionId): Promise<AckMsg> {
  const id = `c${nextId++}`;
  const sent = client.send({ t: "cmd", id, action, op: "down" });
  keepTimers.set(
    action,
    setInterval(() => client.send({ t: "cmd", id: `c${nextId++}`, action, op: "keep" }), KEEP_INTERVAL_MS),
  );
  return track(id, action, sent);
}

/** Akcja hold: koniec. */
export function holdEnd(action: ActionId): Promise<AckMsg> {
  const t = keepTimers.get(action);
  if (t) clearInterval(t);
  keepTimers.delete(action);
  const id = `c${nextId++}`;
  return track(id, action, client.send({ t: "cmd", id, action, op: "up" }));
}

export function sendMedia(action: MediaAction, value?: number): Promise<AckMsg> {
  const id = `m${nextId++}`;
  const sent = client.send({ t: "media", id, action, ...(value !== undefined ? { value } : {}) });
  return track(id, `media.${action}`, sent);
}

/** true, gdy akcja czeka na ack. */
export function usePending(action: ActionId | `media.${MediaAction}`): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => pendingActions.has(action),
  );
}
