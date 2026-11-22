/** Protokół JSON-lines helpera `bin/smtc.ps1` + mapowanie na `MediaState`. */
import { createHash } from "node:crypto";
import type { MediaState } from "@yoga-auto/protocol";

export interface HelperRawState {
  source: string | null;
  status: string;
  title: string | null;
  artist: string | null;
  album: string | null;
  position: number | null;
  duration: number | null;
  canPlay: boolean;
  canPause: boolean;
  canNext: boolean;
  canPrev: boolean;
  canSeek: boolean;
}

export type HelperMsg =
  | { t: "ready" }
  | { t: "state"; s: HelperRawState | null }
  | { t: "art"; key: string; mime: string; b64: string }
  | { t: "ack"; id: number; ok: boolean; err?: string }
  | { t: "error"; msg: string };

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Zwraca null dla śmieci (pusta linia, nie-JSON, nieznany typ) — helper nie może wywrócić providera. */
export function parseLine(line: string): HelperMsg | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return null;
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return null;
  }
  switch (o.t) {
    case "ready":
      return { t: "ready" };
    case "state": {
      if (o.s === null) return { t: "state", s: null };
      if (typeof o.s !== "object" || o.s === undefined) return null;
      const s = o.s as Record<string, unknown>;
      return {
        t: "state",
        s: {
          source: str(s.source),
          status: typeof s.status === "string" ? s.status : "unknown",
          title: str(s.title),
          artist: str(s.artist),
          album: str(s.album),
          position: num(s.position),
          duration: num(s.duration),
          canPlay: s.canPlay === true,
          canPause: s.canPause === true,
          canNext: s.canNext === true,
          canPrev: s.canPrev === true,
          canSeek: s.canSeek === true,
        },
      };
    }
    case "art":
      return typeof o.key === "string" && typeof o.b64 === "string"
        ? { t: "art", key: o.key, mime: typeof o.mime === "string" && o.mime ? o.mime : "image/jpeg", b64: o.b64 }
        : null;
    case "ack":
      return typeof o.id === "number"
        ? { t: "ack", id: o.id, ok: o.ok === true, ...(typeof o.err === "string" ? { err: o.err } : {}) }
        : null;
    case "error":
      return { t: "error", msg: typeof o.msg === "string" ? o.msg : "unknown" };
    default:
      return null;
  }
}

/** Klucz utworu (zgodny z `$key` w smtc.ps1) — wiąże okładkę ze stanem. */
export const trackKey = (s: Pick<HelperRawState, "source" | "title" | "artist" | "album">): string =>
  `${s.source ?? ""}|${s.title ?? ""}|${s.artist ?? ""}|${s.album ?? ""}`;

const STATUSES = new Set(["playing", "paused", "stopped"]);

/** Stan helpera → MediaState. `now` = moment odebrania linii (UI interpoluje pozycję od `positionAt`). */
export function toMediaState(raw: HelperRawState, artHash: string | null, now: number): MediaState {
  return {
    source: raw.source,
    status: STATUSES.has(raw.status) ? (raw.status as MediaState["status"]) : "unknown",
    title: raw.title,
    artist: raw.artist,
    album: raw.album,
    artUrl: artHash ? `/media/art/${artHash}.jpg` : null,
    position: raw.position,
    duration: raw.duration,
    positionAt: raw.position === null ? null : now,
    canPlay: raw.canPlay,
    canPause: raw.canPause,
    canNext: raw.canNext,
    canPrev: raw.canPrev,
    canSeek: raw.canSeek,
  };
}

/** Ten sam algorytm co `artHash` w bridge/src/modules/media.ts. */
export const hashArt = (data: Uint8Array): string => createHash("sha1").update(data).digest("hex").slice(0, 16);
