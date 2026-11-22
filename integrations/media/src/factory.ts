import type { MediaAction, MediaProvider, MediaState } from "@yoga-auto/protocol";
import { MockMediaProvider, NullMediaProvider } from "./mock.ts";
import { SmtcMediaProvider, type SmtcOptions } from "./smtc.ts";

export interface AutoMediaOptions extends SmtcOptions {
  /** Wymuś providera (testy / `--source mock`). */
  force?: "smtc" | "mock" | "null";
  platform?: string;
  log?: (level: "info" | "warn", msg: string) => void;
}

/**
 * Wybiera providera: SMTC na Windows, a gdy helper nie wstanie (brak WinRT, polityka PowerShell, inny system)
 * — `NullMediaProvider`. Nigdy nie rzuca z `start()`, więc nie wywraca bridge'a.
 */
export class AutoMediaProvider implements MediaProvider {
  private inner: MediaProvider;
  private readonly handlers = new Set<(s: MediaState | null) => void>();
  private unsub: (() => void) | null = null;

  private readonly opts: AutoMediaOptions;

  constructor(opts: AutoMediaOptions = {}) {
    this.opts = opts;
    const force = opts.force;
    this.inner =
      force === "mock"
        ? new MockMediaProvider()
        : force === "null" || (force !== "smtc" && (opts.platform ?? process.platform) !== "win32")
          ? new NullMediaProvider()
          : new SmtcMediaProvider(opts);
  }

  get name(): string {
    return this.inner.name;
  }

  async start(): Promise<void> {
    try {
      this.bind();
      await this.inner.start();
    } catch (e) {
      this.opts.log?.(
        "warn",
        `media: ${this.inner.name} niedostępny (${e instanceof Error ? e.message : e}) — fallback null`,
      );
      await this.inner.stop().catch(() => {});
      this.inner = new NullMediaProvider();
      this.bind();
      await this.inner.start();
    }
  }

  async stop(): Promise<void> {
    this.unsub?.();
    this.unsub = null;
    await this.inner.stop();
  }

  getState(): MediaState | null {
    return this.inner.getState();
  }

  onChange(handler: (s: MediaState | null) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  command(action: MediaAction, value?: number): Promise<void> {
    return this.inner.command(action, value);
  }

  getArt(hash: string): Promise<{ mime: string; data: Uint8Array } | null> {
    return this.inner.getArt ? this.inner.getArt(hash) : Promise.resolve(null);
  }

  private bind(): void {
    this.unsub?.();
    this.unsub = this.inner.onChange((s) => this.handlers.forEach((h) => h(s)));
  }
}

export const createMediaProvider = (opts?: AutoMediaOptions): MediaProvider => new AutoMediaProvider(opts);
