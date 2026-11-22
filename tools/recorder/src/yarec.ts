/**
 * Format `.yarec` — gzip JSONL, jedna linia = jeden wpis `{ ts, kind, msg }`.
 *
 *  - `ts`   ms od początku nagrania (liczba, 0.1 ms dokładności)
 *  - `kind` "ipc"  = wiadomość źródła (plugin → bridge, razem z `connected`/`disconnected`) — wejście do replay
 *           "ws"   = wiadomość bridge → UI (`ServerMsg`) — do porównań i debugowania UI
 *           "meta" = nagłówek (pierwsza linia): `{ format:"yarec", version:1, startedAt, source, … }`
 *  - czytelnik MUSI ignorować nieznane `kind`.
 *
 * Plik jest czytelny nawet po twardym ubiciu procesu: writer robi `Z_SYNC_FLUSH` co sekundę,
 * a czytelnik toleruje ucięty strumień gzip.
 */
import { createWriteStream, readFileSync, type WriteStream } from "node:fs";
import { constants, createGzip, gunzipSync, gzipSync, type Gzip } from "node:zlib";
import type { ServerMsg, SourceMsg } from "@yoga-auto/protocol";

export type YarecKind = "ipc" | "ws" | "meta";

export interface YarecEntry {
  ts: number;
  kind: YarecKind | (string & {});
  msg: unknown;
}

export interface YarecMeta {
  format: "yarec";
  version: 1;
  /** ISO czas rozpoczęcia nagrania */
  startedAt: string;
  /** skąd: "pipe" | "mock" | "replay" | "synthetic" … */
  source?: string;
  note?: string;
  [k: string]: unknown;
}

export interface Yarec {
  meta: YarecMeta | null;
  entries: YarecEntry[];
  /** czas ostatniego wpisu, ms */
  durationMs: number;
  /** plik był ucięty (brak końca strumienia gzip) */
  truncated: boolean;
}

export const YAREC_VERSION = 1 as const;

export function isIpcEntry(e: YarecEntry): e is YarecEntry & { kind: "ipc"; msg: SourceMsg } {
  return e.kind === "ipc" && !!e.msg && typeof e.msg === "object";
}
export function isWsEntry(e: YarecEntry): e is YarecEntry & { kind: "ws"; msg: ServerMsg } {
  return e.kind === "ws" && !!e.msg && typeof e.msg === "object";
}

export function makeMeta(meta: Partial<YarecMeta> = {}): YarecMeta {
  return { format: "yarec", version: YAREC_VERSION, startedAt: new Date().toISOString(), ...meta };
}

// ─────────────────────────────── czytanie ───────────────────────────────

export function parseYarec(buf: Buffer): Yarec {
  let text: string;
  let truncated = false;
  try {
    text = gunzipSync(buf).toString("utf8");
  } catch {
    // ucięty plik: weź, co się dało
    text = gunzipSync(buf, { finishFlush: constants.Z_SYNC_FLUSH }).toString("utf8");
    truncated = true;
  }
  const entries: YarecEntry[] = [];
  let meta: YarecMeta | null = null;
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line) continue;
    let e: YarecEntry;
    try {
      e = JSON.parse(line) as YarecEntry;
    } catch {
      if (i >= lines.length - 2) {
        truncated = true; // ostatnia linia ucięta w połowie
        continue;
      }
      throw new Error(`yarec: bad JSON on line ${i + 1}`);
    }
    if (typeof e.ts !== "number" || typeof e.kind !== "string") continue;
    if (e.kind === "meta") {
      meta ??= e.msg as YarecMeta;
      continue;
    }
    entries.push(e);
  }
  const last = entries.at(-1);
  return { meta, entries, durationMs: last ? last.ts : 0, truncated };
}

export function readYarec(file: string): Yarec {
  return parseYarec(readFileSync(file));
}

// ─────────────────────────────── pisanie ───────────────────────────────

export function serializeYarec(y: Pick<Yarec, "meta" | "entries">): Buffer {
  const lines: string[] = [];
  if (y.meta) lines.push(JSON.stringify({ ts: 0, kind: "meta", msg: y.meta }));
  for (const e of y.entries) lines.push(JSON.stringify(e));
  return gzipSync(lines.join("\n") + "\n", { level: 6 });
}

/** Strumieniowy writer. `write()` jest tani (bez blokowania), `close()` domyka gzip. */
export class YarecWriter {
  readonly file: string;
  entries = 0;
  private readonly now: () => number;
  private readonly t0: number;
  private gz: Gzip;
  private out: WriteStream;
  private flushTimer: ReturnType<typeof setInterval>;
  private closed = false;
  private done: Promise<void>;

  constructor(file: string, meta: Partial<YarecMeta> = {}, now: () => number = () => performance.now()) {
    this.file = file;
    this.now = now;
    this.t0 = now();
    this.gz = createGzip({ level: 6 });
    this.out = createWriteStream(file);
    this.gz.pipe(this.out);
    this.done = new Promise((resolve, reject) => {
      this.out.once("finish", resolve);
      this.out.once("error", reject);
    });
    this.gz.write(JSON.stringify({ ts: 0, kind: "meta", msg: makeMeta(meta) }) + "\n");
    this.flushTimer = setInterval(() => this.gz.flush(constants.Z_SYNC_FLUSH), 1000);
    this.flushTimer.unref();
  }

  /** Czas od początku nagrania, ms. */
  elapsed(): number {
    return Math.round((this.now() - this.t0) * 10) / 10;
  }

  write(kind: "ipc" | "ws", msg: unknown, ts: number = this.elapsed()): void {
    if (this.closed) return;
    this.entries++;
    this.gz.write(JSON.stringify({ ts, kind, msg }) + "\n");
  }

  /** Wymusza zapis do dysku tego, co już przyjęto (czytelność po awarii procesu). */
  flush(): void {
    if (!this.closed) this.gz.flush(constants.Z_SYNC_FLUSH);
  }

  async close(): Promise<void> {
    if (this.closed) return this.done;
    this.closed = true;
    clearInterval(this.flushTimer);
    this.gz.end();
    await this.done;
  }
}

// ─────────────────────────────── operacje ───────────────────────────────

export interface YarecInfo {
  file?: string;
  bytes?: number;
  meta: YarecMeta | null;
  durationMs: number;
  truncated: boolean;
  entries: number;
  byKind: Record<string, number>;
  /** liczba wiadomości wg `msg.t`, osobno dla ipc i ws */
  ipc: Record<string, number>;
  ws: Record<string, number>;
  telFrames: number;
  telHz: number | null;
  channels: number;
  game: string | null;
  /** zdarzenia gameplay (`evt`) z czasami */
  events: { ts: number; id: string }[];
  /** przerwy w `tel` > 500 ms */
  gaps: { atMs: number; lenMs: number }[];
}

export function infoYarec(y: Yarec): YarecInfo {
  const byKind: Record<string, number> = {};
  const ipcT: Record<string, number> = {};
  const wsT: Record<string, number> = {};
  const channels = new Set<string>();
  const events: YarecInfo["events"] = [];
  const gaps: YarecInfo["gaps"] = [];
  let game: string | null = null;
  let tel = 0;
  let lastTel = -1;
  for (const e of y.entries) {
    byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
    const t = (e.msg as { t?: string } | null)?.t ?? "?";
    if (e.kind === "ipc") {
      ipcT[t] = (ipcT[t] ?? 0) + 1;
      if (t === "tel") {
        tel++;
        for (const k of Object.keys((e.msg as { ch: object }).ch)) channels.add(k);
        if (lastTel >= 0 && e.ts - lastTel > 500) gaps.push({ atMs: lastTel, lenMs: e.ts - lastTel });
        lastTel = e.ts;
      } else if (t === "hello") {
        const g = (e.msg as { game?: { name?: string; version?: string } }).game;
        game = g ? `${g.name} ${g.version}` : null;
      } else if (t === "evt") events.push({ ts: e.ts, id: (e.msg as { id: string }).id });
    } else if (e.kind === "ws") wsT[t] = (wsT[t] ?? 0) + 1;
  }
  return {
    meta: y.meta,
    durationMs: y.durationMs,
    truncated: y.truncated,
    entries: y.entries.length,
    byKind,
    ipc: ipcT,
    ws: wsT,
    telFrames: tel,
    telHz: tel > 1 && y.durationMs > 0 ? Math.round((tel / (y.durationMs / 1000)) * 10) / 10 : null,
    channels: channels.size,
    game,
    events,
    gaps,
  };
}

/** Stan „gry” w danym momencie nagrania — wystarcza, by zacząć odtwarzanie od środka. */
export interface GameSnapshot {
  hello: SourceMsg | null;
  cfgs: SourceMsg[];
  inputActive: SourceMsg[];
  tel: SourceMsg | null;
}

export function stateAt(entries: readonly YarecEntry[], atMs: number): GameSnapshot {
  let hello: SourceMsg | null = null;
  const cfgs = new Map<string, SourceMsg>();
  const inputActive = new Map<string, SourceMsg>();
  const ch: Record<string, unknown> = {};
  let last: { frame: number; simTime: number; renderTime: number; paused: boolean } | null = null;
  for (const e of entries) {
    if (e.ts > atMs) break;
    if (!isIpcEntry(e)) continue;
    const m = e.msg;
    if (m.t === "hello") hello = m;
    else if (m.t === "cfg") {
      if (m.attrs === null) cfgs.delete(m.id);
      else cfgs.set(m.id, m);
    } else if (m.t === "input.active") inputActive.set(m.device, m);
    else if (m.t === "tel") {
      Object.assign(ch, m.ch);
      last = { frame: m.frame, simTime: m.simTime, renderTime: m.renderTime, paused: m.paused };
    }
  }
  const tel = last ? ({ t: "tel", ...last, ch } as SourceMsg) : null;
  return { hello, cfgs: [...cfgs.values()], inputActive: [...inputActive.values()], tel };
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Wycina fragment [fromMs, toMs]; stan z początku fragmentu dostaje na ts=0 (hello, cfg, pełny tel). */
export function cutYarec(y: Yarec, fromMs: number, toMs: number = Infinity): Yarec {
  const out: YarecEntry[] = [];
  if (fromMs > 0) {
    const snap = stateAt(y.entries, fromMs);
    if (snap.hello) out.push({ ts: 0, kind: "ipc", msg: snap.hello });
    for (const c of snap.cfgs) out.push({ ts: 0, kind: "ipc", msg: c });
    for (const a of snap.inputActive) out.push({ ts: 0, kind: "ipc", msg: a });
    if (snap.tel) out.push({ ts: 0, kind: "ipc", msg: snap.tel });
  }
  for (const e of y.entries) {
    if (e.ts < fromMs || e.ts > toMs) continue;
    out.push({ ...e, ts: r1(e.ts - fromMs) });
  }
  const note = `${y.meta?.note ?? ""} cut ${fromMs}-${Number.isFinite(toMs) ? toMs : "end"} ms`.trim();
  return {
    meta: y.meta ? { ...y.meta, note } : null,
    entries: out,
    durationMs: out.at(-1)?.ts ?? 0,
    truncated: false,
  };
}

/** Skaluje oś czasu: factor 2 = 2× szybciej (ts / 2). */
export function speedYarec(y: Yarec, factor: number): Yarec {
  if (!(factor > 0)) throw new Error("factor must be > 0");
  const entries = y.entries.map((e) => ({ ...e, ts: r1(e.ts / factor) }));
  return { ...y, entries, durationMs: entries.at(-1)?.ts ?? 0, truncated: false };
}
