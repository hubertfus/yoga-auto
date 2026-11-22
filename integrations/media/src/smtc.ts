/**
 * SmtcMediaProvider: Windows SMTC przez proces potomny PowerShell (`bin/smtc.ps1`), bez kompilacji natywnej.
 * Auto-restart z backoffem; po wyczerpaniu prób stan = null, komendy odrzucane (bridge żyje dalej).
 */
import { spawn as nodeSpawn } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import type { MediaAction, MediaProvider, MediaState } from "@yoga-auto/protocol";
import { hashArt, parseLine, toMediaState, trackKey, type HelperMsg, type HelperRawState } from "./helper-protocol.ts";

export interface HelperProcess {
  stdin: Pick<Writable, "write" | "end">;
  stdout: Pick<Readable, "on">;
  on(event: "exit", cb: (code: number | null) => void): unknown;
  on(event: "error", cb: (err: Error) => void): unknown;
  kill(): unknown;
}

export type SpawnHelper = (preferSpotify: boolean) => HelperProcess;

export const DEFAULT_SCRIPT = fileURLToPath(new URL("../bin/smtc.ps1", import.meta.url));

export const defaultSpawn =
  (script = DEFAULT_SCRIPT): SpawnHelper =>
  (preferSpotify) =>
    nodeSpawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, ...(preferSpotify ? ["-PreferSpotify"] : [])],
      { stdio: ["pipe", "pipe", "ignore"], windowsHide: true },
    ) as unknown as HelperProcess;

export interface SmtcOptions {
  spawn?: SpawnHelper;
  /** Wybierz sesję Spotify, jeśli istnieje (inaczej bieżąca sesja systemu). */
  preferSpotify?: boolean;
  /** Czas na `ready` od startu helpera. */
  readyTimeoutMs?: number;
  /** Kolejne nieudane starty (bez `ready`) po których provider się poddaje. */
  maxFailures?: number;
  backoffMs?: (attempt: number) => number;
  commandTimeoutMs?: number;
  /** Ile okładek trzymać w pamięci. */
  maxArt?: number;
  now?: () => number;
}

type Pending = { resolve(): void; reject(e: Error): void; timer: ReturnType<typeof setTimeout> };

export class SmtcMediaProvider implements MediaProvider {
  readonly name = "smtc";
  private readonly opt: Required<Omit<SmtcOptions, "spawn">> & { spawn: SpawnHelper };
  private proc: HelperProcess | null = null;
  private state: MediaState | null = null;
  private raw: HelperRawState | null = null;
  private handlers = new Set<(s: MediaState | null) => void>();
  private art = new Map<string, { mime: string; data: Uint8Array }>(); // hash → obraz (LRU wg wstawienia)
  private artByKey = new Map<string, string>(); // klucz utworu → hash
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private stopped = true;
  private failures = 0;
  private gaveUp = false;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private readyWaiter: { resolve(): void; reject(e: Error): void } | null = null;

  constructor(opts: SmtcOptions = {}) {
    this.opt = {
      spawn: opts.spawn ?? defaultSpawn(),
      preferSpotify: opts.preferSpotify ?? false,
      readyTimeoutMs: opts.readyTimeoutMs ?? 8000,
      maxFailures: opts.maxFailures ?? 5,
      backoffMs: opts.backoffMs ?? ((n) => Math.min(15000, 500 * 2 ** n)),
      commandTimeoutMs: opts.commandTimeoutMs ?? 3000,
      maxArt: opts.maxArt ?? 24,
      now: opts.now ?? Date.now,
    };
  }

  /** Resolve po `ready` pierwszego helpera; reject, gdy helper nie wstał (np. brak WinRT) — wtedy użyj fallbacku. */
  async start(): Promise<void> {
    this.stopped = false;
    this.failures = 0;
    this.gaveUp = false;
    await new Promise<void>((resolve, reject) => {
      this.readyWaiter = { resolve, reject };
      this.launch();
    });
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    this.readyWaiter?.reject(new Error("stopped"));
    this.readyWaiter = null;
    this.failPending(new Error("stopped"));
    const p = this.proc;
    this.proc = null;
    try {
      p?.stdin.end(); // helper kończy się na EOF stdin
    } catch {
      /* ignore */
    }
    p?.kill();
  }

  getState(): MediaState | null {
    return this.state;
  }

  onChange(handler: (s: MediaState | null) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  async getArt(hash: string): Promise<{ mime: string; data: Uint8Array } | null> {
    return this.art.get(hash) ?? null;
  }

  command(action: MediaAction, value?: number): Promise<void> {
    if (!this.proc || this.gaveUp) return Promise.reject(new Error("smtc helper unavailable"));
    const id = this.nextId++;
    const line = JSON.stringify({ id, cmd: action, ...(value !== undefined ? { value } : {}) }) + "\n";
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("smtc command timeout"));
      }, this.opt.commandTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.proc!.stdin.write(line);
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }

  // ---- wnętrze ----

  private launch(): void {
    let proc: HelperProcess;
    try {
      proc = this.opt.spawn(this.opt.preferSpotify);
    } catch (e) {
      this.onProcessGone(null, e instanceof Error ? e : new Error(String(e)));
      return;
    }
    this.proc = proc;
    let buf = "";
    let gotReady = false;
    const readyTimer = setTimeout(() => {
      if (!gotReady && this.proc === proc) {
        proc.kill(); // 'exit' domknie resztę
      }
    }, this.opt.readyTimeoutMs);
    proc.stdout.on("data", (chunk: Buffer | string) => {
      buf += chunk.toString();
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const msg = parseLine(buf.slice(0, i));
        buf = buf.slice(i + 1);
        if (!msg) continue;
        if (msg.t === "ready") {
          gotReady = true;
          clearTimeout(readyTimer);
        }
        this.onMsg(msg);
      }
    });
    proc.on("error", (err) => {
      clearTimeout(readyTimer);
      if (this.proc === proc) this.onProcessGone(null, err);
    });
    proc.on("exit", (code) => {
      clearTimeout(readyTimer);
      if (this.proc === proc) this.onProcessGone(code, new Error(`helper exit ${code}`));
    });
  }

  private onMsg(msg: HelperMsg): void {
    switch (msg.t) {
      case "ready":
        this.failures = 0;
        this.readyWaiter?.resolve();
        this.readyWaiter = null;
        return;
      case "state":
        this.raw = msg.s;
        this.refresh();
        return;
      case "art": {
        const data = new Uint8Array(Buffer.from(msg.b64, "base64"));
        if (data.length === 0) return;
        const hash = hashArt(data);
        this.art.delete(hash);
        this.art.set(hash, { mime: msg.mime, data });
        while (this.art.size > this.opt.maxArt) this.art.delete(this.art.keys().next().value!);
        this.artByKey.set(msg.key, hash);
        if (this.raw && trackKey(this.raw) === msg.key) this.refresh();
        return;
      }
      case "ack": {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.ok) p.resolve();
        else p.reject(new Error(msg.err ?? "command rejected"));
        return;
      }
      case "error":
        return; // błędy chwilowe helpera (np. timeout WinRT) — pętla helpera sama ponawia
    }
  }

  private refresh(): void {
    const next = this.raw ? toMediaState(this.raw, this.artByKey.get(trackKey(this.raw)) ?? null, this.opt.now()) : null;
    this.state = next;
    for (const h of this.handlers) h(next);
  }

  private onProcessGone(_code: number | null, err: Error): void {
    this.proc = null;
    this.failPending(err);
    const hadState = this.raw !== null;
    this.raw = null;
    if (hadState) this.refresh();
    if (this.stopped) return;
    this.failures++;
    if (this.readyWaiter) {
      // helper nie wstał przy starcie (np. brak WinRT) → start() odrzucone, wołający wybiera fallback
      this.gaveUp = true;
      this.readyWaiter.reject(err);
      this.readyWaiter = null;
      return;
    }
    if (this.failures >= this.opt.maxFailures) {
      this.gaveUp = true;
      return;
    }
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (!this.stopped) this.launch();
    }, this.opt.backoffMs(this.failures - 1));
  }

  private failPending(err: Error): void {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
  }
}
