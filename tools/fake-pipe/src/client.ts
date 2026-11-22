/**
 * PipeTestClient — minimalny klient pipe po stronie „bridge'a”: do testów fake-pipe
 * i do `probe` (sprawdzanie prawdziwego DLL S1 względem kontraktu, bez bridge'a).
 */
import { EventEmitter } from "node:events";
import { connect, type Socket } from "node:net";
import { ipc } from "@yoga-auto/protocol";
import { FrameDecoder, encodeFrame, type DecodeResult } from "./framing.ts";

export interface PipeTestClientEvents {
  msg: [msg: unknown];
  bad: [r: Extract<DecodeResult, { ok: false }>];
  close: [];
}

export class PipeTestClient extends EventEmitter<PipeTestClientEvents> {
  readonly path: string;
  readonly received: unknown[] = [];
  readonly bad: Extract<DecodeResult, { ok: false }>[] = [];
  private sock: Socket | null = null;
  private decoder = new FrameDecoder();
  private hb: ReturnType<typeof setInterval> | null = null;

  constructor(path: string) {
    super();
    this.path = path;
  }

  connect(opts: { heartbeat?: boolean } = {}): Promise<void> {
    return new Promise((resolve, reject) => {
      const s = connect(this.path);
      this.sock = s;
      s.once("error", reject);
      s.on("connect", () => {
        s.off("error", reject);
        s.on("error", () => {});
        if (opts.heartbeat !== false) this.startHeartbeat();
        resolve();
      });
      s.on("data", (c: Buffer) => {
        for (const r of this.decoder.push(c)) {
          if (r.ok) {
            this.received.push(r.msg);
            this.emit("msg", r.msg);
          } else {
            this.bad.push(r);
            this.emit("bad", r);
            if (r.error === "too_large") s.destroy();
          }
        }
      });
      s.on("close", () => {
        this.stopHeartbeat();
        this.emit("close");
      });
    });
  }

  get closed(): boolean {
    return !this.sock || this.sock.destroyed;
  }

  startHeartbeat(): void {
    this.stopHeartbeat();
    this.hb = setInterval(() => this.send({ t: "hb" }), ipc.IPC_HEARTBEAT_MS);
  }

  stopHeartbeat(): void {
    if (this.hb) clearInterval(this.hb);
    this.hb = null;
  }

  send(msg: ipc.IpcToPlugin | unknown): void {
    if (this.sock && !this.sock.destroyed) this.sock.write(encodeFrame(msg));
  }

  writeRaw(b: Buffer): void {
    if (this.sock && !this.sock.destroyed) this.sock.write(b);
  }

  /** Czekaj na pierwszą wiadomość spełniającą predykat (także już odebraną, jeśli `fromStart`). */
  waitFor<T = unknown>(pred: (m: unknown) => boolean, timeoutMs = 3000, fromStart = false): Promise<T> {
    if (fromStart) {
      const hit = this.received.find(pred);
      if (hit !== undefined) return Promise.resolve(hit as T);
    }
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        this.off("msg", on);
        reject(new Error(`waitFor timeout after ${timeoutMs} ms`));
      }, timeoutMs);
      const on = (m: unknown) => {
        if (!pred(m)) return;
        clearTimeout(t);
        this.off("msg", on);
        resolve(m as T);
      };
      this.on("msg", on);
    });
  }

  waitClose(timeoutMs = 3000): Promise<void> {
    if (this.closed) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("waitClose timeout")), timeoutMs);
      this.once("close", () => {
        clearTimeout(t);
        resolve();
      });
    });
  }

  close(): void {
    this.stopHeartbeat();
    this.sock?.destroy();
  }
}

export const isT =
  (t: string) =>
  (m: unknown): boolean =>
    !!m && typeof m === "object" && (m as { t?: unknown }).t === t;
