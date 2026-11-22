/**
 * Store telemetrii po stronie UI.
 * - Szybki kanał: `useFastValue(selector, cb)` — wywołuje cb w rAF, BEZ re-renderu Reacta.
 * - Reszta: hooki na useSyncExternalStore z selektorem i porównaniem płytkim.
 * Właściciel po F0: S4.
 */
import { useEffect, useRef, useSyncExternalStore } from "react";
import {
  emptyFullState,
  type Alert,
  type ConfigState,
  type FastState,
  type FullState,
  type GameEvent,
  type GameStatus,
  type MediaState,
  type ServerMsg,
  type SlowState,
} from "@yoga-auto/protocol";

export type ConnectionState = "connecting" | "open" | "closed" | "unauthorized";

export interface ConnectionInfo {
  state: ConnectionState;
  rttMs: number | null;
  session: string | null;
  serverHost: string | null;
  lastMsgAt: number;
}

type Listener = () => void;

class TelemetryStore {
  state: FullState = emptyFullState();
  conn: ConnectionInfo = { state: "connecting", rttMs: null, session: null, serverHost: null, lastMsgAt: 0 };
  lastSeq = 0;
  private listeners = new Set<Listener>();
  private fastListeners = new Set<Listener>();
  private eventListeners = new Set<(e: GameEvent) => void>();
  private rafPending = false;
  /** wywoływane przez client.ts, gdy wykryto dziurę w seq */
  onGap: () => void = () => {};

  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  subscribeFast(l: Listener): () => void {
    this.fastListeners.add(l);
    return () => this.fastListeners.delete(l);
  }

  onEvent(l: (e: GameEvent) => void): () => void {
    this.eventListeners.add(l);
    return () => this.eventListeners.delete(l);
  }

  setConn(patch: Partial<ConnectionInfo>): void {
    this.conn = { ...this.conn, ...patch };
    this.notify();
  }

  apply(msg: ServerMsg): void {
    this.conn.lastMsgAt = performance.now();
    switch (msg.t) {
      case "hello":
        if (this.conn.session && this.conn.session !== msg.session) this.state = emptyFullState();
        this.conn = { ...this.conn, session: msg.session, serverHost: msg.server.hostname };
        break;
      case "snapshot":
        this.state = msg.state;
        this.lastSeq = msg.seq;
        this.notifyFast();
        break;
      case "fast":
        this.checkSeq(msg.seq);
        this.state = { ...this.state, fast: { ...this.state.fast, ...msg.d } };
        this.notifyFast();
        return; // bez notify() — szybkie dane nie re-renderują drzewa
      case "slow":
        this.checkSeq(msg.seq);
        this.state = { ...this.state, slow: { ...this.state.slow, ...msg.d } };
        break;
      case "config":
        this.checkSeq(msg.seq);
        this.state = { ...this.state, config: { ...this.state.config, ...msg.d } };
        break;
      case "status":
        this.checkSeq(msg.seq);
        this.state = { ...this.state, status: msg.status };
        break;
      case "alerts": {
        const cleared = new Set(msg.cleared);
        const byId = new Map(this.state.alerts.filter((a) => !cleared.has(a.id)).map((a) => [a.id, a]));
        for (const a of msg.raised) byId.set(a.id, a);
        this.state = { ...this.state, alerts: [...byId.values()] };
        break;
      }
      case "media":
        this.state = { ...this.state, media: msg.media };
        break;
      case "event":
        this.eventListeners.forEach((l) => l(msg.event));
        return;
      default:
        return;
    }
    this.notify();
    // zmiany fast mogą wpływać na hooki useFast (np. światła) — notyfikacja w rAF
    this.notifyFast();
  }

  private checkSeq(seq: number) {
    if (this.lastSeq && seq > this.lastSeq + 1) this.onGap();
    this.lastSeq = Math.max(this.lastSeq, seq);
  }

  private notify() {
    this.listeners.forEach((l) => l());
  }

  private notifyFast() {
    if (this.rafPending) return;
    this.rafPending = true;
    requestAnimationFrame(() => {
      this.rafPending = false;
      this.fastListeners.forEach((l) => l());
    });
  }
}

export const store = new TelemetryStore();

function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

function useSelected<T>(subscribe: (l: Listener) => () => void, get: () => T): T {
  const cache = useRef<{ v: T } | null>(null);
  return useSyncExternalStore(subscribe, () => {
    const v = get();
    if (cache.current && shallowEqual(cache.current.v, v)) return cache.current.v;
    cache.current = { v };
    return v;
  });
}

const subFast = (l: Listener) => store.subscribeFast(l);

/** Imperatywne: cb(v) w rAF, gdy zmieni się wybrana wartość. Do liczb/wskazówek. */
export function useFastValue<T>(selector: (f: FastState) => T, cb: (v: T) => void): void {
  const sel = useRef(selector);
  const fn = useRef(cb);
  sel.current = selector;
  fn.current = cb;
  useEffect(() => {
    let last: { v: T } | null = null;
    const run = () => {
      const v = sel.current(store.state.fast);
      if (last && shallowEqual(last.v, v)) return;
      last = { v };
      fn.current(v);
    };
    run();
    return store.subscribeFast(run);
  }, []);
}

/** Re-render przy zmianie wybranej wartości z kanału fast (dla rzadko zmiennych pól: światła, hamulce). */
export const useFast = <T>(selector: (f: FastState) => T): T => useSelected(subFast, () => selector(store.state.fast));
export const useSlow = <T>(selector: (s: SlowState) => T): T =>
  useSelected(store.subscribe, () => selector(store.state.slow));
export const useConfig = <T>(selector: (c: ConfigState) => T): T =>
  useSelected(store.subscribe, () => selector(store.state.config));
export const useStatus = (): GameStatus => useSelected(store.subscribe, () => store.state.status);
export const useAlerts = (): Alert[] => useSelected(store.subscribe, () => store.state.alerts);
export const useMedia = (): MediaState | null => useSelected(store.subscribe, () => store.state.media);
export const useConnection = (): ConnectionInfo => useSelected(store.subscribe, () => store.conn);

export function useGameEvents(cb: (e: GameEvent) => void): void {
  const fn = useRef(cb);
  fn.current = cb;
  useEffect(() => store.onEvent((e) => fn.current(e)), []);
}
