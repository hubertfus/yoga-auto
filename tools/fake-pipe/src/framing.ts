/**
 * Ramkowanie IPC v1: uint32 LE długość payloadu + payload UTF-8 JSON (docs/PROTOCOL.md §1, ipc.ts).
 * Używane przez fake-pipe (strona „pluginu”) i przez klienta testowego/probe (strona „bridge'a”).
 */
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ipc } from "@yoga-auto/protocol";

export function encodeFrame(msg: unknown): Buffer {
  return encodeRaw(Buffer.from(JSON.stringify(msg), "utf8"));
}

/** Ramka z dowolnym payloadem (także niepoprawnym JSON-em). */
export function encodeRaw(body: Buffer | string, declaredLength?: number): Buffer {
  const b = typeof body === "string" ? Buffer.from(body, "utf8") : body;
  const head = Buffer.alloc(4);
  head.writeUInt32LE(declaredLength ?? b.length, 0);
  return Buffer.concat([head, b]);
}

export type DecodeResult =
  | { ok: true; msg: unknown; bytes: number }
  | { ok: false; error: "bad_json" | "too_large"; bytes: number; length?: number };

/**
 * Strumieniowy dekoder ramek. `push(chunk)` zwraca kompletne ramki z bufora.
 * Po `too_large` dekoder się zatrzymuje (jak plugin/bridge: zrywamy połączenie).
 */
export class FrameDecoder {
  private buf: Buffer = Buffer.alloc(0);
  private dead = false;
  readonly maxBytes: number;

  constructor(maxBytes: number = ipc.IPC_MAX_FRAME_BYTES) {
    this.maxBytes = maxBytes;
  }

  push(chunk: Buffer): DecodeResult[] {
    if (this.dead) return [];
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    const out: DecodeResult[] = [];
    while (this.buf.length >= 4) {
      const len = this.buf.readUInt32LE(0);
      if (len > this.maxBytes) {
        this.dead = true;
        out.push({ ok: false, error: "too_large", bytes: 4, length: len });
        this.buf = Buffer.alloc(0);
        return out;
      }
      if (this.buf.length < 4 + len) break;
      const body = this.buf.subarray(4, 4 + len);
      this.buf = this.buf.subarray(4 + len);
      try {
        out.push({ ok: true, msg: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)), bytes: 4 + len });
      } catch {
        out.push({ ok: false, error: "bad_json", bytes: 4 + len });
      }
    }
    return out;
  }

  get pending(): number {
    return this.buf.length;
  }
}

/**
 * Unikalna ścieżka pipe do testów (żeby nie kolidować z prawdziwym pluginem ani z równoległymi testami).
 * Windows: `\\.\pipe\yoga-auto-test-…`, inne systemy: socket UNIX w tmpdir (CI na Linuksie).
 */
export function testPipePath(tag = "t"): string {
  const id = `${tag}-${process.pid}-${randomBytes(4).toString("hex")}`;
  return process.platform === "win32" ? `\\\\.\\pipe\\yoga-auto-test-${id}` : join(tmpdir(), `yoga-auto-${id}.sock`);
}
