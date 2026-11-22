/**
 * Wysyłanie komend pojazdu i mediów (PROTOCOL.md §4).
 * - `pending` (czeka na ack) dla pulsującego ringu przycisku,
 * - stan optymistyczny: przycisk zmienia się od razu, cofany przy `ok:false` albo braku ack w 2 s,
 * - hold: `down` → `keep` co 1 s → `up`,
 * - porażki komend jako strumień (`useCommandFailures`) → toasty w shellu.
 * Właściciel: S4.
 */
import { useEffect, useRef, useSyncExternalStore } from "react";
import type { AckMsg, ActionId, ClientMsg, MediaAction, ServerMsg } from "@yoga-auto/protocol";
import { client } from "./client.ts";

export const ACK_TIMEOUT_MS = 2000;
export const KEEP_INTERVAL_MS = 1000;
/** Po udanym ack trzymamy wartość optymistyczną jeszcze chwilę, aż dojdzie delta telemetrii. */
export const OPTIMISTIC_GRACE_MS = 400;

/** Klucz pending/optimistic: id akcji, `media.<akcja>` albo `trip.reset`. */
export type CommandKey = ActionId | `media.${MediaAction}` | "trip.reset";

export interface CommandTransport {
  send(msg: ClientMsg): boolean;
  onMessage(l: (msg: ServerMsg) => void): () => void;
}

export interface CommandFailure {
  key: CommandKey;
  ack: AckMsg;
}

export interface CmdOptions {
  /** wartość pokazywana od razu przez `useOptimistic(key, actual)` do czasu ack / rollbacku */
  optimistic?: unknown;
}

interface PendingEntry {
  key: CommandKey;
  resolve(a: AckMsg): void;
  timer: ReturnType<typeof setTimeout>;
}

export class CommandBus {
  private nextId = 1;
  private pendingById = new Map<string, PendingEntry>();
  private pendingKeys = new Map<CommandKey, number>();
  private optimistic = new Map<CommandKey, { value: unknown; id: string }>();
  private keepTimers = new Map<ActionId, ReturnType<typeof setInterval>>();
  private listeners = new Set<() => void>();
  private failureListeners = new Set<(f: CommandFailure) => void>();

  private readonly transport: CommandTransport;
  private readonly ackTimeoutMs: number;

  constructor(transport: CommandTransport, ackTimeoutMs = ACK_TIMEOUT_MS) {
    this.transport = transport;
    this.ackTimeoutMs = ackTimeoutMs;
    transport.onMessage((msg) => {
      if (msg.t === "ack") this.onAck(msg);
    });
  }

  // ─── API ───

  /** Akcja press / set. */
  sendCmd = (action: ActionId, value?: string, opts?: CmdOptions): Promise<AckMsg> => {
    const id = this.id("c");
    if (opts && "optimistic" in opts) this.setOptimistic(action, opts.optimistic, id);
    const sent = this.transport.send({ t: "cmd", id, action, ...(value !== undefined ? { value } : {}) });
    return this.track(id, action, sent);
  };

  /** Akcja hold: start. Wysyła `keep` co 1 s do `holdEnd`. */
  holdStart = (action: ActionId): Promise<AckMsg> => {
    this.stopKeep(action);
    const id = this.id("c");
    const sent = this.transport.send({ t: "cmd", id, action, op: "down" });
    if (sent)
      this.keepTimers.set(
        action,
        setInterval(() => this.transport.send({ t: "cmd", id: this.id("k"), action, op: "keep" }), KEEP_INTERVAL_MS),
      );
    return this.track(id, action, sent);
  };

  /** Akcja hold: koniec. */
  holdEnd = (action: ActionId): Promise<AckMsg> => {
    this.stopKeep(action);
    const id = this.id("c");
    return this.track(id, action, this.transport.send({ t: "cmd", id, action, op: "up" }));
  };

  /** Puść wszystkie trzymane akcje (np. gdy aplikacja traci widoczność). */
  releaseAllHolds = (): void => {
    for (const action of [...this.keepTimers.keys()]) void this.holdEnd(action);
  };

  sendMedia = (action: MediaAction, value?: number, opts?: CmdOptions): Promise<AckMsg> => {
    const id = this.id("m");
    const key = `media.${action}` as const;
    if (opts && "optimistic" in opts) this.setOptimistic(key, opts.optimistic, id);
    const sent = this.transport.send({ t: "media", id, action, ...(value !== undefined ? { value } : {}) });
    return this.track(id, key, sent);
  };

  /** Reset komputera pokładowego (`trip.reset`). */
  tripReset = (): Promise<AckMsg> => {
    const id = this.id("t");
    return this.track(id, "trip.reset", this.transport.send({ t: "trip.reset", id }));
  };

  isPending = (key: CommandKey): boolean => this.pendingKeys.has(key);
  getOptimistic = (key: CommandKey): { value: unknown } | undefined => this.optimistic.get(key);

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  onFailure(l: (f: CommandFailure) => void): () => void {
    this.failureListeners.add(l);
    return () => this.failureListeners.delete(l);
  }

  // ─── wnętrze ───

  private id(prefix: string) {
    return `${prefix}${this.nextId++}`;
  }

  private notify() {
    this.listeners.forEach((l) => l());
  }

  private setOptimistic(key: CommandKey, value: unknown, id: string) {
    this.optimistic.set(key, { value, id });
    this.notify();
  }

  private clearOptimistic(key: CommandKey, id: string) {
    if (this.optimistic.get(key)?.id !== id) return; // nowsza komenda nadpisała
    this.optimistic.delete(key);
    this.notify();
  }

  private stopKeep(action: ActionId) {
    const t = this.keepTimers.get(action);
    if (t) clearInterval(t);
    this.keepTimers.delete(action);
  }

  private inc(k: CommandKey) {
    this.pendingKeys.set(k, (this.pendingKeys.get(k) ?? 0) + 1);
    this.notify();
  }

  private dec(k: CommandKey) {
    const n = (this.pendingKeys.get(k) ?? 1) - 1;
    if (n <= 0) this.pendingKeys.delete(k);
    else this.pendingKeys.set(k, n);
    this.notify();
  }

  private settle(id: string, key: CommandKey, ack: AckMsg) {
    if (ack.ok) {
      if (this.optimistic.get(key)?.id === id) setTimeout(() => this.clearOptimistic(key, id), OPTIMISTIC_GRACE_MS);
    } else {
      this.clearOptimistic(key, id); // rollback
      this.failureListeners.forEach((l) => l({ key, ack }));
    }
  }

  private track(id: string, key: CommandKey, sent: boolean): Promise<AckMsg> {
    if (!sent) {
      const ack: AckMsg = { t: "ack", id, ok: false, error: "game_not_connected", tookMs: 0 };
      this.settle(id, key, ack);
      return Promise.resolve(ack);
    }
    this.inc(key);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingById.delete(id);
        this.dec(key);
        const ack: AckMsg = { t: "ack", id, ok: false, error: "timeout", tookMs: this.ackTimeoutMs };
        this.settle(id, key, ack);
        resolve(ack);
      }, this.ackTimeoutMs);
      this.pendingById.set(id, { key, resolve, timer });
    });
  }

  private onAck(msg: AckMsg) {
    const p = this.pendingById.get(msg.id);
    if (!p) return;
    clearTimeout(p.timer);
    this.pendingById.delete(msg.id);
    this.dec(p.key);
    this.settle(msg.id, p.key, msg);
    p.resolve(msg);
  }
}

export const commands = new CommandBus(client);

export const { sendCmd, holdStart, holdEnd, releaseAllHolds, sendMedia, tripReset } = commands;

/** true, gdy akcja czeka na ack. */
export function usePending(key: CommandKey): boolean {
  return useSyncExternalStore(commands.subscribe, () => commands.isPending(key));
}

/**
 * Wartość do wyświetlenia: optymistyczna (po tapnięciu, do ack + chwila) albo `actual` z telemetrii.
 * Przykład: `const mode = useOptimistic("lights.mode", actualMode); sendCmd("lights.mode", "low", { optimistic: "low" })`.
 */
export function useOptimistic<T>(key: CommandKey, actual: T): T {
  const o = useSyncExternalStore(commands.subscribe, () => commands.getOptimistic(key));
  return o ? (o.value as T) : actual;
}

/** Callback przy każdej nieudanej komendzie (ok:false, timeout, brak połączenia). */
export function useCommandFailures(cb: (f: CommandFailure) => void): void {
  const fn = useRef(cb);
  fn.current = cb;
  useEffect(() => commands.onFailure((f) => fn.current(f)), []);
}
