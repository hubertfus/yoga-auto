/**
 * Serwer bridge'a: HTTP (PWA + /api) + WebSocket (/ws).
 * F0: hello/snapshot/fast/slow/config/status/event, ping, resync, subscribe, cmd (press/hold), moduły.
 * S2: parowanie PIN + tokeny, progi throttlingu, alerty, trip, mDNS, recorder, rate limit.
 */
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { hostname } from "node:os";
import { extname, join, normalize, resolve } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import {
  DEFAULT_FAST_HZ,
  DEFAULT_SLOW_HZ,
  KEYFRAME_INTERVAL_MS,
  PLACEMENT_MAX_HZ,
  PROTOCOL_MINOR,
  PROTOCOL_VERSION,
  WS_SUBPROTOCOL,
  WsCloseCode,
  type ClientMsg,
  type InfoRes,
  type ServerMsg,
  type SourceMsg,
  type TelemetrySource,
} from "@yoga-auto/protocol";
import { CommandRouter } from "./commands.ts";
import { mapGameplayEvent } from "./events.ts";
import { RawChannels, applyConfig, applyTelemetry } from "./mapping.ts";
import type { BridgeContext, BridgeModule, StaticHandler } from "./modules/types.ts";
import { StateStore } from "./store.ts";

export interface BridgeOptions {
  source: TelemetrySource;
  port: number;
  host?: string;
  fastHz?: number;
  slowHz?: number;
  /** false = dev, bez tokenu */
  auth: boolean;
  /** tokeny akceptowane przy auth (S2: z devices.json) */
  tokens?: Set<string>;
  staticDir?: string;
  modules?: BridgeModule[];
  version?: string;
  log?: (level: "debug" | "info" | "warn" | "error", msg: string) => void;
}

interface Client {
  id: string;
  ws: WebSocket;
  fastHz: number;
  placement: boolean;
  /** harmonogram wysyłki fast (akumulowany, bo timery Windows mają ~15.6 ms rozdzielczości) */
  nextFastAt: number;
  lastPlacementAt: number;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};

const BACKPRESSURE_BYTES = 64 * 1024;

export function isPrivateAddress(addr: string | undefined): boolean {
  if (!addr) return false;
  const a = addr.replace(/^::ffff:/, "");
  if (a === "::1" || a.startsWith("127.")) return true;
  if (/^10\./.test(a) || /^192\.168\./.test(a) || /^169\.254\./.test(a)) return true;
  const m = /^172\.(\d+)\./.exec(a);
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true;
  return /^(fe80|fc|fd)/i.test(a);
}

export async function startBridge(opts: BridgeOptions) {
  const log = opts.log ?? ((l, m) => console.log(`[${l}] ${m}`));
  const session = randomUUID().slice(0, 8);
  const fastHzDefault = opts.fastHz ?? DEFAULT_FAST_HZ;
  const slowHz = opts.slowHz ?? DEFAULT_SLOW_HZ;
  const store = new StateStore(opts.source.kind);
  const raw = new RawChannels();
  const clients = new Map<string, Client>();
  const statics = new Map<string, StaticHandler>();
  const msgHandlers = new Map<string, Set<(msg: ClientMsg, id: string) => void | Promise<void>>>();
  const connectHandlers = new Set<(id: string) => void>();
  const modules = opts.modules ?? [];
  let frame = 0;
  let telDirty = false;

  const router = new CommandRouter(
    () => opts.source,
    () => store.state.status,
  );

  const send = (c: Client, msg: ServerMsg) => {
    if (c.ws.readyState === c.ws.OPEN) c.ws.send(JSON.stringify(msg));
  };
  const broadcast = (msg: ServerMsg) => {
    const s = JSON.stringify(msg);
    for (const c of clients.values()) if (c.ws.readyState === c.ws.OPEN) c.ws.send(s);
  };
  const snapshot = (c: Client) => send(c, { t: "snapshot", seq: store.seq, ts: Date.now(), state: store.state });

  const capabilities = { input: true, media: modules.some((m) => m.capability === "media"), map: false, record: false };

  // ─── źródło telemetrii ───
  opts.source.onMessage((m: SourceMsg) => {
    switch (m.t) {
      case "connected":
        log("info", `source ${opts.source.kind} connected`);
        break;
      case "disconnected":
        store.setStatus({ connected: false, inputActive: false });
        log("warn", `source disconnected${m.reason ? `: ${m.reason}` : ""}`);
        break;
      case "hello":
        store.setStatus({
          connected: true,
          game: m.game.id === "eut2" ? "ets2" : "ats",
          gameVersion: m.game.version,
          inputEnabled: m.inputEnabled,
        });
        log(
          "info",
          `game ${m.game.name} ${m.game.version}, api telemetry ${m.api.telemetry}, ${m.channels.length} channels`,
        );
        break;
      case "tel":
        raw.merge(m.ch);
        frame = m.frame;
        telDirty = true;
        if (m.paused !== store.state.status.paused) {
          broadcast({ t: "event", ts: Date.now(), event: { kind: m.paused ? "game.paused" : "game.resumed" } });
          store.setStatus({ paused: m.paused });
        }
        break;
      case "cfg":
        applyConfig(store, m);
        if (m.id === "job" && m.attrs && store.state.config.job) {
          broadcast({ t: "event", ts: Date.now(), event: { kind: "job.started", job: store.state.config.job } });
        }
        break;
      case "evt": {
        const ev = mapGameplayEvent(m);
        if (ev) broadcast({ t: "event", ts: Date.now(), event: ev });
        break;
      }
      case "input.active":
        if (m.device === "semantical") store.setStatus({ inputActive: m.active });
        break;
      case "in.ack":
        router.onInputAck(m.seq, m.ok);
        break;
      case "log":
        log(m.level, `[plugin] ${m.msg}`);
        break;
    }
    flushImmediate();
  });

  function flushImmediate() {
    const cfg = store.takeConfig();
    if (cfg) broadcast({ t: "config", seq: store.nextSeq(), ts: Date.now(), d: cfg });
    if (store.statusDirty) {
      store.statusDirty = false;
      broadcast({ t: "status", seq: store.nextSeq(), ts: Date.now(), status: store.state.status });
    }
  }

  // ─── zegary kanałów ───
  const tickMs = 1000 / 60;
  const fastTimer = setInterval(() => {
    if (telDirty) {
      applyTelemetry(store, raw);
      telDirty = false;
    }
    if (!store.state.status.connected || !store.dirtyFast.size) return;
    const now = Date.now();
    const due = [...clients.values()].filter((c) => now >= c.nextFastAt);
    if (!due.length) return;
    const d = store.takeFast();
    if (!d) return;
    const seq = store.nextSeq();
    for (const c of due) {
      c.nextFastAt = Math.max(now - 1000 / c.fastHz, c.nextFastAt + 1000 / c.fastHz);
      if (c.ws.bufferedAmount > BACKPRESSURE_BYTES) continue;
      const delta = { ...d };
      if (!c.placement || now - c.lastPlacementAt < 1000 / PLACEMENT_MAX_HZ) delete delta.placement;
      else if (delta.placement) c.lastPlacementAt = now;
      if (Object.keys(delta).length) send(c, { t: "fast", seq, ts: now, frame, d: delta });
    }
  }, tickMs);
  const slowTimer = setInterval(() => {
    if (!store.state.status.connected) return;
    const d = store.takeSlow();
    if (d) broadcast({ t: "slow", seq: store.nextSeq(), ts: Date.now(), d });
  }, 1000 / slowHz);
  const keyframeTimer = setInterval(() => clients.forEach(snapshot), KEYFRAME_INTERVAL_MS);

  // ─── HTTP ───
  const staticDir = opts.staticDir && existsSync(opts.staticDir) ? resolve(opts.staticDir) : null;
  const http = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (!isPrivateAddress(req.socket.remoteAddress)) {
      res.writeHead(403).end();
      return;
    }
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname === "/api/info") {
      const info: InfoRes = {
        name: "yoga-auto-bridge",
        version: opts.version ?? "0.1.0",
        protocol: { major: PROTOCOL_VERSION, minor: PROTOCOL_MINOR },
        paired: !opts.auth,
      };
      res
        .writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" })
        .end(JSON.stringify(info));
      return;
    }
    for (const [prefix, handler] of statics) {
      if (url.pathname.startsWith(prefix)) {
        const r = await handler(url.pathname.slice(prefix.length));
        if (!r) res.writeHead(404).end();
        else res.writeHead(200, { "content-type": r.mime, "cache-control": `max-age=${r.maxAgeS ?? 0}` }).end(r.data);
        return;
      }
    }
    if (!staticDir) {
      res
        .writeHead(200, { "content-type": "text/plain; charset=utf-8" })
        .end("yoga-auto bridge działa. Zbuduj PWA: npm run build:app");
      return;
    }
    let file = normalize(join(staticDir, decodeURIComponent(url.pathname)));
    if (!file.startsWith(staticDir)) {
      res.writeHead(400).end();
      return;
    }
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(staticDir, "index.html");
    const isAsset = url.pathname.startsWith("/assets/");
    res
      .writeHead(200, {
        "content-type": MIME[extname(file)] ?? "application/octet-stream",
        "cache-control": isAsset ? "max-age=31536000, immutable" : "no-cache",
      })
      .end(readFileSync(file));
  });

  // ─── WebSocket ───
  const wss = new WebSocketServer({
    noServer: true,
    handleProtocols: (protocols) => (protocols.has(WS_SUBPROTOCOL) ? WS_SUBPROTOCOL : false),
  });
  http.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname !== "/ws" || !isPrivateAddress(req.socket.remoteAddress)) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const protos = String(req.headers["sec-websocket-protocol"] ?? "")
        .split(",")
        .map((s) => s.trim());
      if (!protos.includes(WS_SUBPROTOCOL)) {
        ws.close(WsCloseCode.ProtocolMismatch, "protocol mismatch");
        return;
      }
      const token = protos.find((p) => p.startsWith("token."))?.slice(6);
      if (opts.auth && (!token || !opts.tokens?.has(token))) {
        ws.close(WsCloseCode.Unauthorized, "unauthorized");
        return;
      }
      onClient(ws);
    });
  });

  function onClient(ws: WebSocket) {
    const c: Client = {
      id: randomUUID().slice(0, 8),
      ws,
      fastHz: fastHzDefault,
      placement: false,
      nextFastAt: 0,
      lastPlacementAt: 0,
    };
    clients.set(c.id, c);
    log("info", `client ${c.id} connected (${clients.size})`);
    send(c, {
      t: "hello",
      protocol: { major: PROTOCOL_VERSION, minor: PROTOCOL_MINOR },
      server: { name: "yoga-auto-bridge", version: opts.version ?? "0.1.0", hostname: hostname() },
      session,
      capabilities,
      rates: { fastHz: c.fastHz, slowHz },
    });
    if (telDirty) applyTelemetry(store, raw);
    snapshot(c);
    connectHandlers.forEach((h) => h(c.id));
    ws.on("message", async (data) => {
      let msg: ClientMsg;
      try {
        msg = JSON.parse(String(data)) as ClientMsg;
      } catch {
        return;
      }
      switch (msg.t) {
        case "ping":
          send(c, { t: "pong", t0: msg.t0, ts: Date.now() });
          break;
        case "resync":
          snapshot(c);
          break;
        case "subscribe":
          if (msg.fastHz) c.fastHz = msg.fastHz;
          if (msg.placement !== undefined) c.placement = msg.placement;
          break;
        case "cmd":
          send(c, await router.handle(msg, c.id));
          break;
        default:
          break;
      }
      msgHandlers.get(msg.t)?.forEach((h) => h(msg, c.id));
    });
    ws.on("close", () => {
      clients.delete(c.id);
      router.releaseClient(c.id);
      log("info", `client ${c.id} disconnected (${clients.size})`);
    });
  }

  // ─── moduły ───
  const ctx: BridgeContext = {
    broadcast,
    sendTo: (id, msg) => {
      const c = clients.get(id);
      if (c) send(c, msg);
    },
    onClientMsg: (type, handler) => {
      const set = msgHandlers.get(type) ?? new Set();
      msgHandlers.set(type, set);
      const h = handler as (msg: ClientMsg, id: string) => void;
      set.add(h);
      return () => set.delete(h);
    },
    registerStatic: (prefix, handler) => statics.set(prefix, handler),
    onClientConnected: (h) => {
      connectHandlers.add(h);
      return () => connectHandlers.delete(h);
    },
    log,
  };
  for (const m of modules) {
    try {
      await m.start(ctx);
      log("info", `module ${m.name} started`);
    } catch (e) {
      log("error", `module ${m.name} failed: ${String(e)}`);
    }
  }

  await opts.source.start();
  await new Promise<void>((r) => http.listen(opts.port, opts.host ?? "0.0.0.0", r));
  const port = (http.address() as { port: number }).port;

  return {
    port,
    store,
    async close() {
      clearInterval(fastTimer);
      clearInterval(slowTimer);
      clearInterval(keyframeTimer);
      for (const c of clients.values()) c.ws.close(WsCloseCode.ServerShutdown, "shutdown");
      await Promise.all(modules.map((m) => m.stop().catch(() => {})));
      await opts.source.stop();
      wss.close();
      await new Promise<void>((r) => http.close(() => r()));
    },
  };
}
