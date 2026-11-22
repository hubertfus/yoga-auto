/**
 * PipeSource — klient named pipe pluginu gry (\\.\pipe\yoga-auto), ramki uint32 LE + JSON.
 * F0: implementacja bazowa (connect/retry/parser/hb). S2: dopracowanie, testy z fake-pipe (S7).
 */
import { connect, type Socket } from "node:net";
import { isIpcFromPlugin } from "../guards.ts";
import { PIPE_NAME, ipc, type SourceMsg, type TelemetrySource } from "@yoga-auto/protocol";

export class PipeSource implements TelemetrySource {
  readonly kind = "pipe" as const;
  private sock: Socket | null = null;
  private buf = Buffer.alloc(0);
  private handlers = new Set<(m: SourceMsg) => void>();
  private retry: ReturnType<typeof setTimeout> | null = null;
  private hb: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private readonly path: string;

  constructor(path: string = PIPE_NAME) {
    this.path = path;
  }

  onMessage(h: (m: SourceMsg) => void): () => void {
    this.handlers.add(h);
    return () => this.handlers.delete(h);
  }

  async start(): Promise<void> {
    this.stopped = false;
    this.connect();
    this.hb = setInterval(() => this.send({ t: "hb" }), ipc.IPC_HEARTBEAT_MS);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.retry) clearTimeout(this.retry);
    if (this.hb) clearInterval(this.hb);
    this.sock?.destroy();
  }

  send(msg: ipc.IpcToPlugin): void {
    if (!this.sock || this.sock.destroyed || this.sock.connecting) return;
    const body = Buffer.from(JSON.stringify(msg), "utf8");
    const head = Buffer.alloc(4);
    head.writeUInt32LE(body.length, 0);
    this.sock.write(Buffer.concat([head, body]));
  }

  private emit(m: SourceMsg) {
    for (const h of this.handlers) {
      try {
        h(m);
      } catch (e) {
        if (m.t !== "log") this.emit({ t: "log", level: "error", msg: `handler threw: ${String(e)}` });
      }
    }
  }

  private connect() {
    if (this.stopped) return;
    const s = connect(this.path);
    this.sock = s;
    this.buf = Buffer.alloc(0);
    s.on("connect", () => this.emit({ t: "connected" }));
    s.on("data", (chunk) => this.onData(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    s.on("error", () => {});
    s.on("close", () => {
      if (this.sock === s) this.emit({ t: "disconnected", reason: "pipe closed" });
      this.retry = setTimeout(() => this.connect(), 1000);
    });
  }

  private onData(chunk: Buffer) {
    this.buf = Buffer.concat([this.buf, chunk]);
    while (this.buf.length >= 4) {
      const len = this.buf.readUInt32LE(0);
      if (len > ipc.IPC_MAX_FRAME_BYTES) {
        this.emit({ t: "log", level: "error", msg: `frame too large: ${len}` });
        this.sock?.destroy();
        return;
      }
      if (this.buf.length < 4 + len) return;
      const body = this.buf.subarray(4, 4 + len).toString("utf8");
      this.buf = this.buf.subarray(4 + len);
      let msg: unknown;
      try {
        msg = JSON.parse(body);
      } catch {
        this.emit({ t: "log", level: "warn", msg: "bad frame" });
        continue;
      }
      if (!isIpcFromPlugin(msg)) {
        this.emit({ t: "log", level: "warn", msg: "bad frame (shape)" });
        continue;
      }
      // wyjątki handlerów NIE są „bad frame”: loguj osobno, nie przerywaj parsera
      try {
        this.emit(msg as ipc.IpcFromPlugin);
      } catch (e) {
        this.emit({ t: "log", level: "error", msg: `handler threw: ${String(e)}` });
      }
    }
  }
}
