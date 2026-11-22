/**
 * Wiadomości WebSocket bridge ↔ UI.
 * Każda wiadomość to jeden obiekt JSON (jedna ramka tekstowa WS) z polem `t`.
 */
import type { ActionId } from "./actions.ts";
import type { Alert } from "./alerts.ts";
import type { GameEvent } from "./events.ts";
import type { MediaAction, MediaState } from "./media.ts";
import type { RouteMsg, RouteSetMsg } from "./route.ts";
import type { ConfigState, Delta, FastState, FullState, GameStatus, SlowState } from "./state.ts";

// ═══════════════════════════════ bridge → UI ═══════════════════════════════

/** Pierwsza wiadomość po połączeniu. */
export interface HelloMsg {
  t: "hello";
  protocol: { major: number; minor: number };
  server: { name: string; version: string; hostname: string };
  /** id sesji bridge'a; zmiana = bridge zrestartowany → klient czyści stan */
  session: string;
  capabilities: {
    input: boolean;
    media: boolean;
    map: boolean;
    record: boolean;
    /** bridge liczy trasę GPS (jest `route-graph.bin`); brak pola = nie */
    route?: boolean;
  };
  rates: { fastHz: number; slowHz: number };
}

/** Pełny stan. Po `hello`, po `resync` oraz co KEYFRAME_INTERVAL_MS. */
export interface SnapshotMsg {
  t: "snapshot";
  /** numer sekwencji ostatniej zastosowanej delty */
  seq: number;
  ts: number;
  state: FullState;
}

/** Delta kanału szybkiego. */
export interface FastMsg {
  t: "fast";
  seq: number;
  ts: number;
  /** klatka gry (z pluginu), do wykrywania zamrożeń */
  frame: number;
  d: Delta<FastState>;
}

/** Delta kanału wolnego. */
export interface SlowMsg {
  t: "slow";
  seq: number;
  ts: number;
  d: Delta<SlowState>;
}

export interface ConfigMsg {
  t: "config";
  seq: number;
  ts: number;
  d: Delta<ConfigState>;
}

export interface StatusMsg {
  t: "status";
  seq: number;
  ts: number;
  status: GameStatus;
}

export interface EventMsg {
  t: "event";
  ts: number;
  event: GameEvent;
}

/** Zmiana zbioru aktywnych alertów: `raised` nowe / zaktualizowane, `cleared` id do usunięcia. */
export interface AlertsMsg {
  t: "alerts";
  ts: number;
  raised: Alert[];
  cleared: string[];
}

export interface MediaMsg {
  t: "media";
  ts: number;
  media: MediaState | null;
}

/** Odpowiedź na `cmd` / `media`. */
export interface AckMsg {
  t: "ack";
  /** id z komendy klienta */
  id: string;
  ok: boolean;
  error?: AckError;
  /** dla kind:"set" — stan osiągnięty */
  state?: string;
  /** ms od odebrania komendy do potwierdzenia */
  tookMs: number;
}

export type AckError =
  | "unknown_action"
  | "input_disabled"
  | "game_not_connected"
  | "game_paused"
  | "invalid_value"
  | "timeout" // stan docelowy nie osiągnięty w czasie
  | "rate_limited"
  | "not_supported"; // akcja ma device, którego nie ma (np. generic niezbindowane)

export interface PongMsg {
  t: "pong";
  /** echo z ping */
  t0: number;
  /** czas bridge'a */
  ts: number;
}

export type ServerMsg =
  | HelloMsg
  | SnapshotMsg
  | FastMsg
  | SlowMsg
  | ConfigMsg
  | StatusMsg
  | EventMsg
  | AlertsMsg
  | MediaMsg
  | AckMsg
  | PongMsg
  | RouteMsg;

// ═══════════════════════════════ UI → bridge ═══════════════════════════════

/**
 * Komenda pojazdu.
 * - kind "press": `op` pominięte.
 * - kind "hold":  `op: "down"` potem `op: "up"` (ten sam `action`). Bridge zwalnia sam po HOLD_MAX_MS,
 *                 przy rozłączeniu WS oraz gdy klient przez HOLD_WATCHDOG_MS nie wyśle `hold.keep`.
 * - kind "set":   `value` z `ACTIONS[action].values`.
 */
export interface CmdMsg {
  t: "cmd";
  /** unikalne id klienta (np. nanoid), echo w `ack` */
  id: string;
  action: ActionId;
  op?: "down" | "up" | "keep";
  value?: string;
}

export interface MediaCmdMsg {
  t: "media";
  id: string;
  action: MediaAction;
  /** dla seek: sekundy */
  value?: number;
}

/** Ustawienia subskrypcji klienta. */
export interface SubscribeMsg {
  t: "subscribe";
  fastHz?: 15 | 30 | 60;
  /** czy wysyłać `placement` (mapa) */
  placement?: boolean;
}

/** Prośba o pełny snapshot (np. po wykryciu dziury w `seq`). */
export interface ResyncMsg {
  t: "resync";
}

export interface PingMsg {
  t: "ping";
  t0: number;
}

/** Reset komputera pokładowego. */
export interface TripResetMsg {
  t: "trip.reset";
  id: string;
}

export type ClientMsg = CmdMsg | MediaCmdMsg | SubscribeMsg | ResyncMsg | PingMsg | TripResetMsg | RouteSetMsg;

// ═══════════════════════════════ stałe ═══════════════════════════════

export const KEYFRAME_INTERVAL_MS = 10_000;
export const DEFAULT_FAST_HZ = 30;
export const DEFAULT_SLOW_HZ = 2;
export const PLACEMENT_MAX_HZ = 10;
/** Klient: brak jakiejkolwiek wiadomości przez tyle ms → uznaj połączenie za martwe, reconnect. */
export const CLIENT_STALE_MS = 3_000;
/** Klient wysyła ping co tyle ms (pomiar RTT + keepalive). */
export const PING_INTERVAL_MS = 1_000;
/** Reconnect: backoff 250 ms → ×2 → max 4 s, z jitterem ±20%. */
export const RECONNECT_MIN_MS = 250;
export const RECONNECT_MAX_MS = 4_000;
/** Maks. komend na sekundę na klienta. */
export const CMD_RATE_LIMIT_PER_S = 20;
/** Timeout potwierdzenia akcji `set`. */
export const SET_TIMEOUT_MS = 1_500;

// ═══════════════════════════════ HTTP (parowanie) ═══════════════════════════════

/** POST /api/pair/start → bridge pokazuje PIN na PC. */
export interface PairStartRes {
  requestId: string;
  /** s ważności PIN-u */
  expiresIn: number;
}

/** POST /api/pair/confirm */
export interface PairConfirmReq {
  requestId: string;
  pin: string;
  deviceName: string;
}

export interface PairConfirmRes {
  ok: boolean;
  /** base64url, 32 B — tylko gdy ok */
  token?: string;
  error?: "invalid_pin" | "expired" | "too_many_attempts";
}

/** GET /api/info (bez autoryzacji) — do ekranu "Łączenie…" */
export interface InfoRes {
  name: string;
  version: string;
  protocol: { major: number; minor: number };
  paired: boolean; // czy podany w nagłówku token jest ważny
}
