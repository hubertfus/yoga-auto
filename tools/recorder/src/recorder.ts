/**
 * Interfejs `Recorder` — hook, który bridge (S2) wywołuje przy każdej wiadomości źródła i każdej
 * wiadomości wysłanej do klientów WS. Szczegóły i diff dla bridge'a: docs/proposals/s7-recorder-hook.md.
 */
import type { ServerMsg, SourceMsg } from "@yoga-auto/protocol";
import { YarecWriter, type YarecMeta } from "./yarec.ts";

export interface Recorder {
  readonly file: string;
  /** wiadomość źródła (plugin → bridge), włącznie z `connected` / `disconnected` */
  ipc(msg: SourceMsg): void;
  /** wiadomość bridge → UI (ServerMsg), tak jak poszła do klientów (broadcast: raz) */
  ws(msg: ServerMsg): void;
  /** wymuś zapis na dysk (np. na SIGINT przed process.exit) */
  flush(): void;
  close(): Promise<void>;
}

export interface YarecRecorderOptions {
  /** `false` = nagrywaj tylko wejście IPC (mniejszy plik; wystarcza do replay) */
  ws?: boolean;
  /** `ws` bez `fast` (większość objętości) */
  wsSkipFast?: boolean;
  meta?: Partial<YarecMeta>;
  now?: () => number;
}

export class YarecRecorder implements Recorder {
  private readonly w: YarecWriter;
  private readonly opts: YarecRecorderOptions;

  constructor(file: string, opts: YarecRecorderOptions = {}) {
    this.opts = opts;
    this.w = new YarecWriter(file, opts.meta, opts.now);
  }

  get file(): string {
    return this.w.file;
  }

  get entries(): number {
    return this.w.entries;
  }

  ipc(msg: SourceMsg): void {
    this.w.write("ipc", msg);
  }

  ws(msg: ServerMsg): void {
    if (this.opts.ws === false) return;
    if (this.opts.wsSkipFast && msg.t === "fast") return;
    this.w.write("ws", msg);
  }

  flush(): void {
    this.w.flush();
  }

  close(): Promise<void> {
    return this.w.close();
  }
}

/** Nagrywarka, która nic nie robi (domyślna, gdy `--record` nie podano). */
export const nullRecorder: Recorder = {
  file: "",
  ipc() {},
  ws() {},
  flush() {},
  async close() {},
};
