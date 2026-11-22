/**
 * Interfejsy wymiennych źródeł danych po stronie bridge'a.
 * Kontrakt między S2 (bridge), S7 (mock/replay/fake-pipe) i S6 (media).
 */
import type { IpcFromPlugin, IpcToPlugin } from "./ipc.ts";
import type { MediaAction, MediaState } from "./media.ts";
import type { GameStatus } from "./state.ts";

/** Wiadomości źródła = wiadomości IPC pluginu + zdarzenia połączenia. */
export type SourceMsg = IpcFromPlugin | { t: "connected" } | { t: "disconnected"; reason?: string };

/**
 * Źródło telemetrii mówiące poziomem IPC (surowe nazwy kanałów SDK).
 * Implementacje: PipeSource (bridge, S2), MockSource (tools/mock), ReplaySource (tools/recorder, S7).
 * Po `start()` źródło emituje `connected`, potem `hello`, wszystkie `cfg`, pierwszy pełny `tel`.
 */
export interface TelemetrySource {
  readonly kind: GameStatus["source"];
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Komendy do „pluginu” (in, hb, releaseAll, opts). Ignorowane, gdy niepołączone. */
  send(msg: IpcToPlugin): void;
  /** Zwraca funkcję wyrejestrowującą. */
  onMessage(handler: (msg: SourceMsg) => void): () => void;
}

/** Dostawca mediów (SMTC). Implementacje w integrations/media (S6). */
export interface MediaProvider {
  readonly name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  getState(): MediaState | null;
  onChange(handler: (state: MediaState | null) => void): () => void;
  command(action: MediaAction, value?: number): Promise<void>;
  /** Okładka po hashu z `artUrl` (`/media/art/<hash>.jpg`). */
  getArt?(hash: string): Promise<{ mime: string; data: Uint8Array } | null>;
}
