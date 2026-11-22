/**
 * Store telemetrii po stronie UI.
 * - Szybki kanał: `useFastValue(selector, cb)` — wywołuje cb w rAF, BEZ re-renderu Reacta.
 * - Reszta: hooki na useSyncExternalStore z selektorem i porównaniem płytkim
 *   (komponent re-renderuje się tylko, gdy zmieni się to, co wybrał selektor).
 * Właściciel: S4.
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
  type HelloMsg,
  type MediaState,
  type RouteInfo,
  type ServerMsg,
  type SlowState,
} from "@yoga-auto/protocol";

/**
 * - `connecting` — trwa próba połączenia WS
 * - `open` — połączono (po `hello`)
 * - `closed` — rozłączono, czeka na kolejną próbę (backoff)
 * - `unauthorized` — bridge odrzucił token (4003) → ekran parowania
 * - `mismatch` — inna wersja major protokołu (4001 / `hello.protocol.major`)
 */
export type ConnectionState = "connecting" | "open" | "closed" | "unauthorized" | "mismatch";

export interface ConnectionInfo {
  state: ConnectionState;
  rttMs: number | null;
  session: string | null;
  serverHost: string | null;
  /** performance.now() ostatniej wiadomości z bridge'a */
  lastMsgAt: number;
  /** numer kolejnej próby połączenia od ostatniego udanego `hello` (0 = połączony) */
  attempt: number;
  /** performance.now(), kiedy nastąpi następna próba (gdy `closed`) */
  nextRetryAt: number | null;
  /** kod ostatniego zamknięcia WS */
  lastCloseCode: number | null;
  /** ostatnie `hello` (wersja bridge'a, capabilities, rates) */
  hello: HelloMsg | null;
}

type Listener = () => void;

/** Minimalny odstęp między kolejnymi `resync` (ochrona przed pętlą gap → snapshot → gap). */
export const RESYNC_MIN_INTERVAL_MS = 1000;

const raf: (cb: () => void) => void = (cb) =>
  typeof requestAnimationFrame === "function" ? requestAnimationFrame(cb) : setTimeout(cb, 16);

const initialConn = (): ConnectionInfo => ({
  state: "connecting",
  rttMs: null,
  session: null,
  serverHost: null,
  lastMsgAt: 0,
  attempt: 0,
  nextRetryAt: null,
  lastCloseCode: null,
  hello: null,
});

export class TelemetryStore {
  state: FullState = emptyFullState();
  /** trasa GPS liczona przez bridge (wiadomość `route`), poza `FullState` — przychodzi rzadko i jest duża */
  route: RouteInfo | null = null;
  conn: ConnectionInfo = initialConn();
  lastSeq = 0;
  /** wysłano `resync`, czekamy na snapshot — nie spamujemy kolejnymi */
  resyncPending = false;
  private lastResyncAt = -Infinity;
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

  subscribeFast = (l: Listener): (() => void) => {
    this.fastListeners.add(l);
    return () => this.fastListeners.delete(l);
  };

  onEvent(l: (e: GameEvent) => void): () => void {
    this.eventListeners.add(l);
    return () => this.eventListeners.delete(l);
  }

  setConn(patch: Partial<ConnectionInfo>): void {
    this.conn = { ...this.conn, ...patch };
    this.notify();
  }

  /** Czyści stan (testy, zmiana sesji bridge'a). */
  reset(): void {
    this.state = emptyFullState();
    this.route = null;
    this.conn = initialConn();
    this.lastSeq = 0;
    this.resyncPending = false;
    this.lastResyncAt = -Infinity;
    this.rafPending = false;
    this.notify();
    this.notifyFast();
  }

  apply(msg: ServerMsg): void {
    this.conn.lastMsgAt = performance.now();
    switch (msg.t) {
      case "hello": {
        // Zasada klienta 1: inna sesja = bridge zrestartowany → stan od zera.
        if (this.conn.session && this.conn.session !== msg.session) {
          this.state = emptyFullState();
          this.route = null;
        }
        // Nowe połączenie: licznik seq zaczyna się od snapshotu.
        this.lastSeq = 0;
        this.resyncPending = false;
        this.conn = { ...this.conn, session: msg.session, serverHost: msg.server.hostname, hello: msg };
        break;
      }
      case "snapshot":
        this.state = msg.state;
        this.lastSeq = msg.seq;
        this.resyncPending = false;
        break;
      case "fast":
        this.checkSeq(msg.seq);
        this.state = { ...this.state, fast: { ...this.state.fast, ...msg.d } };
        this.notifyFast();
        return; // bez notify() — szybkie dane nie re-renderują drzewa (useFast działa na subskrypcji fast)
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
      case "route":
        this.route = msg.route;
        break;
      case "event":
        this.eventListeners.forEach((l) => l(msg.event));
        return;
      default:
        return; // zasada 5: nieznany `t` → ignoruj
    }
    this.notify();
    // snapshot/hello mogą zmienić fast — powiadom subskrybentów fast w rAF
    this.notifyFast();
  }

  private checkSeq(seq: number) {
    if (typeof seq !== "number") return;
    // Zasada 2: dziura w seq → resync; delty stosujemy dalej do czasu snapshotu.
    // Limit: bridge, który notorycznie gubi seq, nie może zalać nas snapshotami (≤ 1 resync/s).
    const gap = this.lastSeq > 0 && seq > this.lastSeq + 1;
    if (gap && !this.resyncPending && performance.now() - this.lastResyncAt >= RESYNC_MIN_INTERVAL_MS) {
      this.resyncPending = true;
      this.lastResyncAt = performance.now();
      this.onGap();
    }
    this.lastSeq = Math.max(this.lastSeq, seq);
  }

  private notify() {
    this.listeners.forEach((l) => l());
  }

  private notifyFast() {
    if (this.rafPending) return;
    this.rafPending = true;
    raf(() => {
      this.rafPending = false;
      this.fastListeners.forEach((l) => l());
    });
  }
}

export const store = new TelemetryStore();

export function shallowEqual(a: unknown, b: unknown): boolean {
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

/** Imperatywne: cb(v) w rAF, gdy zmieni się wybrana wartość. Do liczb/wskazówek. Bez re-renderu. */
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
export const useFast = <T>(selector: (f: FastState) => T): T =>
  useSelected(store.subscribeFast, () => selector(store.state.fast));
export const useSlow = <T>(selector: (s: SlowState) => T): T =>
  useSelected(store.subscribe, () => selector(store.state.slow));
export const useConfig = <T>(selector: (c: ConfigState) => T): T =>
  useSelected(store.subscribe, () => selector(store.state.config));
export const useStatus = (): GameStatus => useSelected(store.subscribe, () => store.state.status);
export const useAlerts = (): Alert[] => useSelected(store.subscribe, () => store.state.alerts);
export const useMedia = (): MediaState | null => useSelected(store.subscribe, () => store.state.media);
export const useRoute = (): RouteInfo | null => useSyncExternalStore(store.subscribe, () => store.route);
export const useConnection = (): ConnectionInfo => useSelected(store.subscribe, () => store.conn);
/** Wybrany fragment informacji o połączeniu (mniej re-renderów niż useConnection). */
export const useConnectionSelect = <T>(selector: (c: ConnectionInfo) => T): T =>
  useSelected(store.subscribe, () => selector(store.conn));

export function useGameEvents(cb: (e: GameEvent) => void): void {
  const fn = useRef(cb);
  fn.current = cb;
  useEffect(() => store.onEvent((e) => fn.current(e)), []);
}
