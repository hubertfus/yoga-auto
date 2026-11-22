/** Czyste funkcje UI mediów (testowane bez DOM). */
import type { MediaState } from "@yoga-auto/protocol";

export type MediaView = "off" | "idle" | "track";

/** off = bridge bez modułu mediów; idle = brak sesji / brak tytułu; track = jest co pokazać. */
export function mediaView(capable: boolean, m: MediaState | null): MediaView {
  if (!capable) return "off";
  if (!m || (!m.title && !m.artist)) return "idle";
  return "track";
}

/**
 * Pozycja interpolowana (s). `elapsedMs` = czas od ODEBRANIA stanu na kliencie (nie od `positionAt`,
 * bo zegary PC i tabletu się różnią). Bez pozycji → null; poza `playing` pozycja stoi.
 */
export function interpolate(m: MediaState, elapsedMs: number): number | null {
  if (m.position === null) return null;
  const p = m.status === "playing" ? m.position + Math.max(0, elapsedMs) / 1000 : m.position;
  return Math.max(0, m.duration !== null ? Math.min(m.duration, p) : p);
}

export function formatTime(s: number | null): string {
  if (s === null || !Number.isFinite(s)) return "–:––";
  const t = Math.floor(s);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = (t % 60).toString().padStart(2, "0");
  return h > 0 ? `${h}:${m.toString().padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** Nazwa aplikacji do pokazania: "Spotify.exe" → "Spotify", "Chrome" → "Chrome". */
export function sourceLabel(source: string | null): string | null {
  if (!source) return null;
  const base =
    source
      .replace(/\.exe$/i, "")
      .split("!")
      .pop() ?? source;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

/** Okładka serwowana przez bridge za tokenem (`?k=`). Zmiana utworu = nowy hash = nowy URL. */
export function artSrc(artUrl: string | null, token: string | null): string | null {
  if (!artUrl) return null;
  return token ? `${artUrl}${artUrl.includes("?") ? "&" : "?"}k=${encodeURIComponent(token)}` : artUrl;
}

export const progressFraction = (pos: number | null, dur: number | null): number =>
  pos !== null && dur !== null && dur > 0 ? Math.max(0, Math.min(1, pos / dur)) : 0;
