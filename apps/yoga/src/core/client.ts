/**
 * Klient protokołu WS: połączenie, reconnect (backoff + jitter), ping/RTT, wykrywanie martwego łącza, resync.
 * Właściciel po F0: S4.
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
} from "@yoga-auto/protocol";
import { store } from "./store.ts";

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

class ProtocolClient {
  private ws: WebSocket | null = null;
  private backoff = RECONNECT_MIN_MS;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<ServerListener>();
  private url = "";
  private started = false;

  start(url = defaultUrl()): void {
    if (this.started) return;
    this.started = true;
    this.url = url;
    store.onGap = () => this.send({ t: "resync" });
    this.open();
  }

  send(msg: ClientMsg): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  onMessage(l: ServerListener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  /** Wymuś ponowne połączenie (np. po sparowaniu). */
  reconnect(): void {
    this.ws?.close();
  }

  private open() {
    const token = getToken();
    const protocols = [WS_SUBPROTOCOL, ...(token ? [`token.${token}`] : [])];
    store.setConn({ state: "connecting" });
    const ws = new WebSocket(this.url, protocols);
    this.ws = ws;
    ws.onopen = () => {
      this.backoff = RECONNECT_MIN_MS;
      store.setConn({ state: "open" });
      this.pingTimer = setInterval(() => this.tick(), PING_INTERVAL_MS);
    };
    ws.onmessage = (e) => {
      let msg: ServerMsg;
      try {
        msg = JSON.parse(e.data as string) as ServerMsg;
      } catch {
        return;
      }
      if (msg.t === "hello" && msg.protocol.major !== PROTOCOL_VERSION) console.warn("protocol mismatch", msg.protocol);
      if (msg.t === "pong") store.setConn({ rttMs: Math.round(performance.now() - msg.t0) });
      store.apply(msg);
      this.listeners.forEach((l) => l(msg));
    };
    ws.onclose = (e) => {
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = null;
      this.ws = null;
      store.setConn({ state: e.code === WsCloseCode.Unauthorized ? "unauthorized" : "closed" });
      const jitter = 1 + (Math.random() * 0.4 - 0.2);
      this.reconnectTimer = setTimeout(() => this.open(), this.backoff * jitter);
      this.backoff = Math.min(RECONNECT_MAX_MS, this.backoff * 2);
    };
  }

  private tick() {
    this.send({ t: "ping", t0: performance.now() });
    if (store.conn.lastMsgAt && performance.now() - store.conn.lastMsgAt > CLIENT_STALE_MS) this.ws?.close();
  }
}

function defaultUrl(): string {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}/ws`;
}

export const client = new ProtocolClient();
