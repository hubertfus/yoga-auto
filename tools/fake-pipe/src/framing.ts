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
  private chunks: Buffer[] = [];
  private size = 0;
  /** ile bajtów potrzeba do następnej decyzji: 4 (nagłówek) albo 4 + długość (cała ramka) */
  private need = 4;
  private haveHeader = false;
  private dead = false;
  readonly maxBytes: number;

  constructor(maxBytes: number = ipc.IPC_MAX_FRAME_BYTES) {
    this.maxBytes = maxBytes;
  }

  push(chunk: Buffer): DecodeResult[] {
    if (this.dead) return [];
    this.chunks.push(chunk);
    this.size += chunk.length;
    const out: DecodeResult[] = [];
    // sklejamy dopiero, gdy jest komplet bajtów do kolejnego kroku (bez kwadratowego kopiowania przy małych kawałkach)
    while (this.size >= this.need) {
      const buf = this.chunks.length === 1 ? this.chunks[0]! : Buffer.concat(this.chunks, this.size);
      this.chunks = [buf];
      if (!this.haveHeader) {
        const len = buf.readUInt32LE(0);
        if (len > this.maxBytes) {
          this.dead = true;
          this.chunks = [];
          this.size = 0;
          out.push({ ok: false, error: "too_large", bytes: 4, length: len });
          return out;
        }
        this.haveHeader = true;
        this.need = 4 + len;
        if (this.size < this.need) break;
      }
      const body = buf.subarray(4, this.need);
      const rest = buf.subarray(this.need);
      const bytes = this.need;
      this.chunks = rest.length ? [rest] : [];
      this.size = rest.length;
      this.need = 4;
      this.haveHeader = false;
      try {
        out.push({ ok: true, msg: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)), bytes });
      } catch {
        out.push({ ok: false, error: "bad_json", bytes });
      }
    }
    return out;
  }

  /** bajty zbuforowane, czekające na resztę ramki */
  get pending(): number {
    return this.size;
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
