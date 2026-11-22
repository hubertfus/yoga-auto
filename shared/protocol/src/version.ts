/**
 * Wersjonowanie protokołu.
 *
 * - PROTOCOL_VERSION (major): zmiana niekompatybilna (usunięcie/zmiana typu pola, zmiana semantyki).
 *   Klient i bridge MUSZĄ mieć ten sam major — inaczej bridge zamyka połączenie kodem 4001.
 * - PROTOCOL_MINOR: zmiany addytywne (nowe pole opcjonalne, nowa akcja, nowy typ eventu).
 *   Klient MUSI ignorować nieznane pola, nieznane typy wiadomości i nieznane kody alertów/eventów.
 * - IPC_VERSION: wersja protokołu plugin ↔ bridge (niezależna od WS).
 */
export const PROTOCOL_VERSION = 1 as const;
export const PROTOCOL_MINOR = 0 as const;
export const IPC_VERSION = 1 as const;

/** Subprotokół WebSocket. Token przekazywany jako drugi subprotokół: `token.<base64url>`. */
export const WS_SUBPROTOCOL = `yoga-auto.v${PROTOCOL_VERSION}` as const;

export const DEFAULT_PORT = 7420 as const;
export const MDNS_SERVICE_TYPE = "_yoga-auto._tcp" as const;
export const PIPE_NAME = "\\\\.\\pipe\\yoga-auto" as const;

/** Kody zamknięcia WS (4000–4999 = aplikacyjne). */
export const WsCloseCode = {
  ProtocolMismatch: 4001,
  Unauthorized: 4003,
  RateLimited: 4008,
  ServerShutdown: 4010,
} as const;
