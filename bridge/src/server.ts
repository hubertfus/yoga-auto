/**
 * Serwer bridge'a: HTTP (PWA + /api) + WebSocket (/ws).
 * F0: hello/snapshot/fast/slow/config/status/event, ping, resync, subscribe, cmd (press/hold), moduły.
 * S2: parowanie PIN + tokeny, progi throttlingu, alerty, trip, mDNS, recorder, rate limit.
 */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { hostname } from "node:os";
import { resolve } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import {
  DEFAULT_FAST_HZ,
  DEFAULT_SLOW_HZ,
  IPC_VERSION,
  KEYFRAME_INTERVAL_MS,
  PLACEMENT_MAX_HZ,
  PROTOCOL_MINOR,
  PROTOCOL_VERSION,
  WS_SUBPROTOCOL,
  WsCloseCode,
  type ClientMsg,
  type ServerMsg,
  type SourceMsg,
  type TelemetrySource,
} from "@yoga-auto/protocol";
import { hostAllowed, isPrivateAddress, originAllowed, type OriginPolicy } from "./access.ts";
import { isClientFrame } from "./guards.ts";
import { AlertEngine, type AlertThresholds } from "./alerts.ts";
import { CommandRouter } from "./commands.ts";
import type { DeviceStore } from "./devices.ts";
import { authorize, createHttpHandler } from "./http.ts";
import { PairingManager, type PinAnnouncement } from "./pairing.ts";
import { RateLimiter } from "./ratelimit.ts";
import { mapGameplayEvent } from "./events.ts";
import { RawChannels, applyConfig, applyTelemetry } from "./mapping.ts";
import type { BridgeContext, BridgeModule, StaticHandler } from "./modules/types.ts";
import { LatencyStats } from "./metrics.ts";
import { StateStore } from "./store.ts";
import { ClientStream } from "./throttle.ts";
import { MemoryTripStorage, TripComputer, type TripStorage } from "./trip.ts";

/**
 * Hook nagrywania sesji (implementacja: `YarecRecorder` z tools/recorder, S7). Strukturalny, żeby
 * bridge nie zależał od pakietu rekordera.
 */
export interface Recorder {
  readonly file: string;
  /** wiadomość źródła (także connected/disconnected) */
  ipc(msg: SourceMsg): void;
  /** wiadomość bridge → UI (`clientId` gdy wysłana do jednego klienta) */
  ws(msg: ServerMsg, clientId?: string): void;
  flush(): void;
  close(): Promise<void>;
}

export interface BridgeOptions {
  source: TelemetrySource;
  port: number;
  host?: string;
  fastHz?: number;
  slowHz?: number;
  /** false = dev (`--no-auth`), bez tokenu i parowania */
  auth: boolean;
  /** sparowane urządzenia (wymagane przy `auth: true`) */
  devices?: DeviceStore;
  /** wywoływane przy `/api/pair/start`: pokaż PIN na PC (konsola/tray) */
  onPin?: (a: PinAnnouncement) => void;
  /** co ile ms sprawdzać, czy CLI odwołało urządzenie (domyślnie 2000) */
  devicePollMs?: number;
  /** gdzie trzymać komputer pokładowy (domyślnie pamięć; CLI podaje FileTripStorage) */
  tripStorage?: TripStorage;
  /** nadpisanie progów alertów (testy) */
  alertThresholds?: Partial<AlertThresholds>;
  /** okres przeliczania alertów/tripu, ms (domyślnie 250) */
  rulesEveryMs?: number;
  /** dodatkowe dozwolone nazwy hostów (Host/Origin) */
  extraHosts?: string[];
  staticDir?: string;
  /** katalog z `*.pmtiles` (M4) */
  tilesDir?: string;
  modules?: BridgeModule[];
  /** nagrywanie sesji do .yarec (`--record`) */
  recorder?: Recorder;
  version?: string;
  log?: (level: "debug" | "info" | "warn" | "error", msg: string) => void;
}

interface Client {
  id: string;
  /** id sparowanego urządzenia (null przy --no-auth) */
  deviceId: string | null;
  ws: WebSocket;
  /** throttling per klient: własny seq, własny obraz „co wysłano”, własny harmonogram fast */
  stream: ClientStream;
}

const BACKPRESSURE_BYTES = 64 * 1024;

export { isPrivateAddress };

export async function startBridge(opts: BridgeOptions) {
  const log = opts.log ?? ((l, m) => console.log(`[${l}] ${m}`));
  if (opts.auth && !opts.devices) throw new Error("auth: true wymaga opts.devices (DeviceStore)");
  const session = randomUUID().slice(0, 8);
  const devices = opts.devices ?? null;
  const policy: OriginPolicy = {
    extraHosts: (opts.extraHosts ?? []).map((h) => h.toLowerCase()),
    ownHostnames: [hostname().toLowerCase(), `${hostname().toLowerCase()}.local`],
  };
  const pairing =
    opts.auth && devices
      ? new PairingManager(devices, opts.onPin ?? ((a) => log("info", `PIN parowania: ${a.pin} (ważny ${a.expiresIn} s)`)))
      : null;
  const fastHzDefault = opts.fastHz ?? DEFAULT_FAST_HZ;
  const slowHz = opts.slowHz ?? DEFAULT_SLOW_HZ;
  const store = new StateStore(opts.source.kind);
  const raw = new RawChannels();
  const clients = new Map<string, Client>();
  const statics = new Map<string, StaticHandler>();
  const msgHandlers = new Map<string, Set<(msg: ClientMsg, id: string) => void | Promise<void>>>();
  const connectHandlers = new Set<(id: string) => void>();
  const modules = opts.modules ?? [];
  /** plugin z inną wersją IPC: ignoruj tel/cfg/evt do ponownego `hello` */
  let ipcMismatch = false;
  let frame = 0;
  let telDirty = false;
  /** performance.now() ostatniej ramki `tel` (latencja pipe → WS) */
  let telAt = 0;
  const telLatency = new LatencyStats();

  const router = new CommandRouter({
    source: () => opts.source,
    state: () => {
      if (telDirty) applyTel();
      return store.state;
    },
    log,
  });
  const rate = new RateLimiter();
  const trip = new TripComputer(opts.tripStorage ?? new MemoryTripStorage());
  const alertEngine = new AlertEngine(opts.alertThresholds);
  store.setSlow("trip", trip.state);

  /** błąd rekordera (dysk pełny itp.) nie może zatrzymać bridge'a */
  const safeRecord = (fn: () => void) => {
    try {
      fn();
    } catch (e) {
      log("error", `recorder: ${String(e)}`);
    }
  };
  const isOpen = (c: Client) => c.ws.readyState === c.ws.OPEN;
  const send = (c: Client, msg: ServerMsg) => {
    if (!isOpen(c)) return;
    c.ws.send(JSON.stringify(msg));
    safeRecord(() => opts.recorder?.ws(msg, c.id));
  };
  const broadcast = (msg: ServerMsg) => {
    const s = JSON.stringify(msg);
    safeRecord(() => opts.recorder?.ws(msg)); // raz, nie per klient
    for (const c of clients.values()) if (isOpen(c)) c.ws.send(s);
  };
  /** Wiadomości z `seq` (fast/slow/config/status) — numerowane per klient. */
  type SeqMsg = Extract<ServerMsg, { seq: number }>;
  const broadcastSeq = (make: (seq: number) => SeqMsg) => {
    for (const c of clients.values()) if (isOpen(c)) send(c, make(c.stream.nextSeq()));
  };
  const snapshot = (c: Client) => {
    if (telDirty) applyTel();
    send(c, { t: "snapshot", seq: c.stream.synced(store.state), ts: Date.now(), state: store.state });
  };

  const capabilities = { input: true, media: modules.some((m) => m.capability === "media"), map: false, record: !!opts.recorder };

  // ─── źródło telemetrii ───
  opts.source.onMessage((m: SourceMsg) => {
    safeRecord(() => opts.recorder?.ipc(m));
    if (ipcMismatch && (m.t === "tel" || m.t === "cfg" || m.t === "evt")) return;
    switch (m.t) {
      case "connected":
        log("info", `source ${opts.source.kind} connected`);
        break;
      case "disconnected":
        ipcMismatch = false;
        store.setStatus({ connected: false, inputActive: false });
        router.onSourceDisconnected();
        router.setInputs(null);
        log("warn", `source disconnected${m.reason ? `: ${m.reason}` : ""}`);
        break;
      case "hello":
        if (m.ipc !== IPC_VERSION) {
          ipcMismatch = true;
          router.setInputs(null);
          store.setStatus({ connected: false, inputActive: false });
          log("error", `plugin speaks IPC v${m.ipc}, bridge expects v${IPC_VERSION}: refusing (update plugin/bridge)`);
          break;
        }
        ipcMismatch = false;
        router.setInputs(m.inputs);
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
        telAt = performance.now();
        if (m.paused !== store.state.status.paused) {
          broadcast({ t: "event", ts: Date.now(), event: { kind: m.paused ? "game.paused" : "game.resumed" } });
          store.setStatus({ paused: m.paused });
        }
        flushImmediate();
        flushFast();
        return;
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
    if (cfg) broadcastSeq((seq) => ({ t: "config", seq, ts: Date.now(), d: cfg }));
    if (store.statusDirty) {
      store.statusDirty = false;
      const status = store.state.status;
      broadcastSeq((seq) => ({ t: "status", seq, ts: Date.now(), status }));
    }
  }

  function applyTel() {
    applyTelemetry(store, raw);
    telDirty = false;
    router.notifyState();
  }

  /** Wyślij `fast` każdemu klientowi, który jest „na czasie” i ma coś istotnego do dostania. */
  function flushFast() {
    if (telDirty) applyTel();
    if (!store.state.status.connected || !clients.size) return;
    const now = Date.now();
    const fast = store.state.fast;
    for (const c of clients.values()) {
      if (!isOpen(c) || !c.stream.fastDue(now)) continue;
      // backpressure: pomiń `fast` (stan „wysłany” się nie zmienia → następna delta będzie pełna)
      if (c.ws.bufferedAmount > BACKPRESSURE_BYTES) continue;
      const d = c.stream.takeFast(fast, now);
      if (!d) continue;
      send(c, { t: "fast", seq: c.stream.nextSeq(), ts: now, frame, d });
      if (telAt) telLatency.add(performance.now() - telAt);
    }
  }

  // ─── zegary kanałów ───
  // `fast` wychodzi głównie od razu po ramce `tel` (flushFast w obsłudze źródła); zegar 60 Hz to
  // dogrywka dla klientów, którzy nie byli „na czasie”, gdy przyszła ostatnia ramka.
  const fastTimer = setInterval(flushFast, 1000 / 60);
  const slowTimer = setInterval(() => {
    if (telDirty) applyTel();
    if (!store.state.status.connected) return;
    const now = Date.now();
    for (const c of clients.values()) {
      if (!isOpen(c)) continue;
      const d = c.stream.takeSlow(store.state.slow);
      if (d) send(c, { t: "slow", seq: c.stream.nextSeq(), ts: now, d });
    }
  }, 1000 / slowHz);
  // reguły pochodne: komputer pokładowy + alerty
  const rulesTimer = setInterval(() => {
    if (telDirty) applyTel();
    const now = Date.now();
    store.setSlow("trip", trip.update(store.state, now));
    const delta = alertEngine.update(store.state, now);
    if (delta) {
      store.setAlerts(alertEngine.alerts);
      broadcast({ t: "alerts", ts: now, raised: delta.raised, cleared: delta.cleared });
    }
  }, opts.rulesEveryMs ?? 250);
  const keyframeTimer = setInterval(() => clients.forEach(snapshot), KEYFRAME_INTERVAL_MS);
  const metricsTimer = setInterval(() => {
    if (!telLatency.count) return;
    const s = telLatency.summary();
    log("debug", `latency tel→ws.send ms: n=${s.n} p50=${s.p50.toFixed(2)} p95=${s.p95.toFixed(2)} p99=${s.p99.toFixed(2)} max=${s.max.toFixed(2)}`);
    telLatency.reset();
  }, 10_000);

  // ─── HTTP ───
  const staticDir = opts.staticDir && existsSync(opts.staticDir) ? resolve(opts.staticDir) : null;
  const httpDeps = {
    auth: opts.auth,
    devices,
    pairing,
    statics,
    staticDir,
    tilesDir: opts.tilesDir ?? null,
    version: opts.version ?? "0.1.0",
    policy,
    log,
  };
  const handler = createHttpHandler(httpDeps);
  const http = createServer((req, res) => {
    handler(req, res).catch((e) => {
      log("error", `http ${req.url}: ${String(e)}`);
      if (!res.headersSent) res.writeHead(500).end();
      else res.destroy();
    });
  });

  // ─── WebSocket ───
  const wss = new WebSocketServer({
    noServer: true,
    handleProtocols: (protocols) => (protocols.has(WS_SUBPROTOCOL) ? WS_SUBPROTOCOL : false),
  });
  const reject = (socket: import("node:stream").Duplex, code: number, why: string) => {
    socket.write(`HTTP/1.1 ${code} ${why}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    socket.destroy();
  };
  http.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://x");
    const ip = req.socket.remoteAddress;
    if (url.pathname !== "/ws") return reject(socket, 404, "Not Found");
    if (!isPrivateAddress(ip)) return reject(socket, 403, "Forbidden");
    if (!hostAllowed(req.headers.host, policy)) return reject(socket, 421, "Misdirected Request");
    if (!originAllowed(req.headers.origin, req.headers.host, policy)) return reject(socket, 403, "Forbidden Origin");
    wss.handleUpgrade(req, socket, head, (ws) => {
      const protos = String(req.headers["sec-websocket-protocol"] ?? "")
        .split(",")
        .map((p) => p.trim());
      if (!protos.includes(WS_SUBPROTOCOL)) {
        ws.close(WsCloseCode.ProtocolMismatch, "protocol mismatch");
        return;
      }
      const token = protos.find((p) => p.startsWith("token."))?.slice(6);
      const dev = authorize(httpDeps, token, ip);
      if (!dev) {
        log("warn", `ws: odrzucono ${ip} (brak/zły token)`);
        ws.close(WsCloseCode.Unauthorized, "unauthorized");
        return;
      }
      onClient(ws, dev === "open" ? null : dev.id);
    });
  });

  // odwołanie urządzenia z CLI (osobny proces) → rozłącz je w działającym bridge'u
  const devicesTimer = devices
    ? setInterval(() => {
        for (const id of devices.reloadIfChanged())
          for (const c of clients.values())
            if (c.deviceId === id) {
              log("info", `urządzenie ${id} odwołane, rozłączam klienta ${c.id}`);
              c.ws.close(WsCloseCode.Unauthorized, "revoked");
            }
      }, opts.devicePollMs ?? 2000)
    : null;
  devicesTimer?.unref();

  function onClient(ws: WebSocket, deviceId: string | null) {
    const c: Client = {
      id: randomUUID().slice(0, 8),
      deviceId,
      ws,
      stream: new ClientStream(store.state, { fastHz: fastHzDefault }),
    };
    clients.set(c.id, c);
    log("info", `client ${c.id} connected (${clients.size})`);
    send(c, {
      t: "hello",
      protocol: { major: PROTOCOL_VERSION, minor: PROTOCOL_MINOR },
      server: { name: "yoga-auto-bridge", version: opts.version ?? "0.1.0", hostname: hostname() },
      session,
      capabilities,
      rates: { fastHz: c.stream.fastHz, slowHz },
    });
    snapshot(c);
    connectHandlers.forEach((h) => h(c.id));
    ws.on("message", (data) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(data));
      } catch {
        return;
      }
      // `null`, tablice, liczby, obiekty bez `t` — ignoruj (nie ubijaj procesu)
      if (!isClientFrame(parsed)) return;
      handleClientMsg(parsed as ClientMsg).catch((e) => log("error", `client ${c.id} msg ${parsed.t}: ${String(e)}`));
    });
    const handleClientMsg = async (msg: ClientMsg) => {
      switch (msg.t) {
        case "ping":
          send(c, { t: "pong", t0: msg.t0, ts: Date.now() });
          break;
        case "resync":
          snapshot(c);
          break;
        case "subscribe":
          if (msg.fastHz === 15 || msg.fastHz === 30 || msg.fastHz === 60) c.stream.fastHz = msg.fastHz;
          if (typeof msg.placement === "boolean") c.stream.placement = msg.placement;
          break;
        case "cmd":
        case "media":
        case "trip.reset": {
          const verdict = rate.hit(c.id);
          if (verdict === "flood") {
            log("warn", `client ${c.id} flooding commands, closing`);
            ws.close(WsCloseCode.RateLimited, "rate limited");
            return;
          }
          if (verdict === "limited") {
            if (msg.t !== "trip.reset") send(c, { t: "ack", id: msg.id, ok: false, error: "rate_limited", tookMs: 0 });
            return;
          }
          if (msg.t === "cmd") send(c, await router.handle(msg, c.id));
          else if (msg.t === "trip.reset") {
            trip.reset();
            store.setSlow("trip", trip.state);
            send(c, { t: "ack", id: msg.id, ok: true, tookMs: 0 });
          }
          break;
        }
        default:
          break;
      }
      for (const h of msgHandlers.get(msg.t) ?? []) {
        try {
          await h(msg, c.id);
        } catch (e) {
          log("error", `module handler ${msg.t}: ${String(e)}`);
        }
      }
    };
    ws.on("close", () => {
      clients.delete(c.id);
      rate.forget(c.id);
      const hadHolds = router.holdCount(c.id) > 0;
      router.releaseClient(c.id);
      // ostatni klient z trzymanym wejściem odszedł: pas bezpieczeństwa po stronie pluginu
      if (!clients.size && hadHolds) opts.source.send({ t: "releaseAll" });
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
    router,
    pairing,
    async close() {
      clearInterval(fastTimer);
      clearInterval(slowTimer);
      clearInterval(keyframeTimer);
      clearInterval(rulesTimer);
      trip.flush();
      safeRecord(() => opts.recorder?.flush());
      clearInterval(metricsTimer);
      if (devicesTimer) clearInterval(devicesTimer);
      devices?.close();
      for (const c of clients.values()) c.ws.close(WsCloseCode.ServerShutdown, "shutdown");
      await Promise.all(modules.map((m) => m.stop().catch(() => {})));
      await opts.source.stop();
      await opts.recorder?.close().catch((e) => log("error", `recorder close: ${String(e)}`));
      wss.close();
      await new Promise<void>((r) => http.close(() => r()));
    },
  };
}
