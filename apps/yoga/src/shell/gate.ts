/**
 * Bramka połączenia: co pokazać zamiast aplikacji.
 * - `pairing`    → bridge odrzucił token (4003)
 * - `connecting` → WS nie jest otwarty (łączenie, backoff, niezgodna wersja)
 * - `ready`      → połączono; `gameOff` = bridge OK, ale gra nie wysyła danych
 */
import type { ConnectionState } from "../core/store.ts";

export type Gate = "pairing" | "connecting" | "ready";

export function gateFor(state: ConnectionState): Gate {
  if (state === "unauthorized") return "pairing";
  if (state === "open") return "ready";
  return "connecting";
}

/** Które ekrany są użyteczne bez gry (ustawienia zawsze). */
export const OFFLINE_OK_SCREENS: ReadonlySet<string> = new Set(["settings"]);
