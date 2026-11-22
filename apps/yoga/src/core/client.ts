/**
 * Klient protokołu WS (PROTOCOL.md §2): połączenie, reconnect (backoff 250 ms → 4 s, jitter ±20%),
 * ping/RTT co 1 s, wykrywanie martwego łącza (CLIENT_STALE_MS), resync przy dziurze w `seq`,
 * czyszczenie stanu przy zmianie `session`, subskrypcja (`fastHz`, `placement`).
 * Właściciel: S4.
 */
import {
  CLIENT_STALE_MS,
  PING_INTERVAL_MS,
  PROTOCOL_VERSION,
  RECONNECT_MAX_MS,
  RECONNECT_MIN_MS,
  WS_SUBPROTOCOL,
  WsCloseCode,
  type ClientMsg,
  type ServerMsg,
  type SubscribeMsg,
} from "@yoga-auto/protocol";
import { store as defaultStore, type TelemetryStore } from "./store.ts";

const TOKEN_KEY = "yoga-auto.token";

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* prywatne okno */
  }
}

type ServerListener = (msg: ServerMsg) => void;
export type Subscription = Omit<SubscribeMsg, "t">;

type WsCtor = new (url: string, protocols?: string | string[]) => WebSocket;

export interface ClientDeps {
  WebSocket?: WsCtor;
  store?: TelemetryStore;
  /** źródło losowości dla jittera (testy) */
  random?: () => number;
  /** podpinaj `online`/`visibilitychange` (domyślnie true, gdy jest `window`) */
  listenWindow?: boolean;
}

const OPEN = 1;

export class ProtocolClient {
  private ws: WebSocket | null = null;
  private backoff = RECONNECT_MIN_MS;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<ServerListener>();
  private url = "";
  private started = false;
  private sub: Subscription = {};
  private readonly Ws: WsCtor;
  private readonly store: TelemetryStore;
  private readonly random: () => number;
  private readonly listenWindow: boolean;
  private detachWindow: (() => void) | null = null;

  constructor(deps: ClientDeps = {}) {
    this.Ws = deps.WebSocket ?? (globalThis.WebSocket as WsCtor);
    this.store = deps.store ?? defaultStore;
    this.random = deps.random ?? Math.random;
    this.listenWindow = deps.listenWindow ?? typeof window !== "undefined";
  }

  start(url = defaultUrl()): void {
    if (this.started) return;
    this.started = true;
    this.url = url;
    this.store.onGap = () => this.send({ t: "resync" });
    if (this.listenWindow) this.attachWindow();
    this.open();
  }

  stop(): void {
    this.started = false;
    this.clearTimers();
    this.detachWindow?.();
    this.detachWindow = null;
    const ws = this.ws;
    this.ws = null;
    ws?.close();
  }

  send(msg: ClientMsg): boolean {
    if (!this.ws || this.ws.readyState !== OPEN) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  onMessage(l: ServerListener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  /** Zmień subskrypcję (scalana z poprzednią, wysyłana od razu i po każdym ponownym połączeniu). */
  subscribe(patch: Subscription): void {
    this.sub = { ...this.sub, ...patch };
    this.send({ t: "subscribe", ...this.sub });
  }

  get subscription(): Subscription {
    return this.sub;
  }

  /** Połącz ponownie od razu (np. po sparowaniu, przycisk „Spróbuj teraz”). Resetuje backoff. */
  reconnect(): void {
    if (!this.started) return;
    this.backoff = RECONNECT_MIN_MS;
    this.dropSocket();
    this.open();
  }

  private open() {
    this.clearTimers();
    const token = getToken();
    const protocols = [WS_SUBPROTOCOL, ...(token ? [`token.${token}`] : [])];
    this.store.setConn({ state: "connecting", nextRetryAt: null, attempt: this.store.conn.attempt + 1 });
    let ws: WebSocket;
    try {
      ws = new this.Ws(this.url, protocols);
    } catch {
      this.scheduleReconnect("closed");
      return;
    }
    this.ws = ws;
    // Watchdog łączenia: host w LAN, który nie odpowiada (np. PC uśpiony), potrafi wisieć dziesiątki sekund.
    this.connectTimer = setTimeout(() => {
      if (this.ws === ws && ws.readyState !== OPEN) this.fail(ws, "closed");
    }, CLIENT_STALE_MS);
    ws.onopen = () => {
      if (this.ws !== ws) return;
      if (this.connectTimer) clearTimeout(this.connectTimer);
      this.connectTimer = null;
      // Martwe łącze wykrywamy od otwarcia, także gdy bridge nie przyśle `hello`.
      this.store.conn.lastMsgAt = performance.now();
      this.pingTimer = setInterval(() => this.tick(ws), PING_INTERVAL_MS);
    };
    ws.onmessage = (e) => {
      if (this.ws !== ws) return;
      let msg: ServerMsg;
      try {
        msg = JSON.parse(e.data as string) as ServerMsg;
      } catch {
        return;
      }
      if (!msg || typeof msg !== "object" || typeof msg.t !== "string") return;
      if (msg.t === "hello") {
        if (msg.protocol?.major !== PROTOCOL_VERSION) {
          console.warn("yoga-auto: protocol mismatch", msg.protocol);
          this.fail(ws, "mismatch");
          return;
        }
        this.backoff = RECONNECT_MIN_MS;
        this.store.apply(msg);
        this.store.setConn({ state: "open", attempt: 0, lastCloseCode: null });
        if (Object.keys(this.sub).length) this.send({ t: "subscribe", ...this.sub });
      } else {
        if (msg.t === "pong" && typeof msg.t0 === "number")
          this.store.setConn({ rttMs: Math.max(0, Math.round(performance.now() - msg.t0)) });
        this.store.apply(msg);
      }
      this.listeners.forEach((l) => l(msg));
    };
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      const state =
        e.code === WsCloseCode.Unauthorized
          ? "unauthorized"
          : e.code === WsCloseCode.ProtocolMismatch
            ? "mismatch"
            : "closed";
      this.ws = null;
      this.store.setConn({ lastCloseCode: e.code });
      this.scheduleReconnect(state);
    };
    ws.onerror = () => {
      /* onclose przyjdzie zaraz po */
    };
  }

  /** Zamknij gniazdo i przejdź do stanu `state` bez czekania na onclose. */
  private fail(ws: WebSocket, state: "closed" | "mismatch") {
    if (this.ws !== ws) return;
    this.dropSocket();
    this.scheduleReconnect(state);
  }

  private dropSocket() {
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
      try {
        ws.close();
      } catch {
        /* już zamknięte */
      }
    }
  }

  private scheduleReconnect(state: "closed" | "unauthorized" | "mismatch") {
    this.clearTimers();
    if (!this.started) return;
    if (state === "unauthorized") {
      // Bez tokenu nie ma sensu próbować w kółko — ekran parowania wywoła reconnect().
      this.store.setConn({ state, nextRetryAt: null, rttMs: null });
      return;
    }
    if (state === "mismatch") this.backoff = RECONNECT_MAX_MS;
    const jitter = 1 + (this.random() * 0.4 - 0.2);
    const delay = Math.round(this.backoff * jitter);
    this.backoff = Math.min(RECONNECT_MAX_MS, this.backoff * 2);
    this.store.setConn({ state, nextRetryAt: performance.now() + delay, rttMs: null });
    this.reconnectTimer = setTimeout(() => this.open(), delay);
  }

  private clearTimers() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.connectTimer) clearTimeout(this.connectTimer);
    this.pingTimer = this.reconnectTimer = this.connectTimer = null;
  }

  private tick(ws: WebSocket) {
    if (this.ws !== ws) return;
    const last = this.store.conn.lastMsgAt;
    // Zasada 4: cisza dłużej niż CLIENT_STALE_MS → zamknij i połącz ponownie.
    if (last && performance.now() - last > CLIENT_STALE_MS) {
      this.fail(ws, "closed");
      return;
    }
    this.send({ t: "ping", t0: performance.now() });
  }

  private attachWindow() {
    // Po wybudzeniu Yogi / powrocie Wi-Fi nie czekamy na backoff.
    const kick = () => {
      if (!this.started) return;
      const s = this.store.conn.state;
      if (s === "closed") this.reconnect();
      else if (s === "open" && this.ws && performance.now() - this.store.conn.lastMsgAt > CLIENT_STALE_MS)
        this.fail(this.ws, "closed");
    };
    const onVis = () => {
      if (document.visibilityState === "visible") kick();
    };
    window.addEventListener("online", kick);
    document.addEventListener("visibilitychange", onVis);
    this.detachWindow = () => {
      window.removeEventListener("online", kick);
      document.removeEventListener("visibilitychange", onVis);
    };
  }
}

function defaultUrl(): string {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}/ws`;
}

export const client = new ProtocolClient();
