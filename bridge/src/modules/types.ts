/**
 * Moduły bridge'a (np. media). Kontrakt S2 ↔ S6 (punkt integracji I5).
 * Moduł dostaje BridgeContext przy starcie i może: rozgłaszać wiadomości, obsługiwać wiadomości klientów,
 * rejestrować statyczne zasoby HTTP (np. okładki).
 */
import type { ClientMsg, MediaState, ServerMsg } from "@yoga-auto/protocol";

export interface StaticHandler {
  /** Zwraca treść albo null (→ 404). `path` = część po prefiksie. */
  (path: string): Promise<{ mime: string; data: Uint8Array; maxAgeS?: number } | null>;
}

export interface BridgeContext {
  /** Wyślij do wszystkich zautoryzowanych klientów. */
  broadcast(msg: ServerMsg): void;
  /** Wyślij do jednego klienta. */
  sendTo(clientId: string, msg: ServerMsg): void;
  /** Obsługa wiadomości klienta danego typu. Zwraca funkcję wyrejestrowującą. */
  onClientMsg<T extends ClientMsg["t"]>(
    type: T,
    handler: (msg: Extract<ClientMsg, { t: T }>, clientId: string) => void | Promise<void>,
  ): () => void;
  /** Zarejestruj prefiks HTTP, np. "/media/art/". Wymaga tokenu (query `k`). */
  registerStatic(prefix: string, handler: StaticHandler): void;
  /** Wywołane przy nowym kliencie po `snapshot` (np. żeby wysłać `media`). */
  onClientConnected(handler: (clientId: string) => void): () => void;
  /** Ustaw `state.media` w store'rze — trafia do `snapshot`/keyframe'ów (stan mediów żyje w providerze). */
  setMedia(media: MediaState | null): void;
  log(level: "debug" | "info" | "warn" | "error", msg: string): void;
}

export interface BridgeModule {
  readonly name: string;
  /** Capability ogłaszane w `hello.capabilities` (np. "media"). */
  readonly capability?: "media" | "map" | "record";
  start(ctx: BridgeContext): Promise<void>;
  stop(): Promise<void>;
}
