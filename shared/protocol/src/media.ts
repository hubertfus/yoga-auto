/** Media (SMTC na PC). Dostarczane przez integrations/media → bridge → UI. */

export interface MediaState {
  /** np. "Spotify.exe", "msedge.exe" */
  source: string | null;
  status: "playing" | "paused" | "stopped" | "unknown";
  title: string | null;
  artist: string | null;
  album: string | null;
  /** ścieżka HTTP na bridge'u, np. "/media/art/ab12.jpg" (bridge serwuje okładkę), null = brak */
  artUrl: string | null;
  /** s */
  position: number | null;
  /** s */
  duration: number | null;
  /** ms epoch bridge'a, kiedy zmierzono `position` (UI interpoluje) */
  positionAt: number | null;
  canPlay: boolean;
  canPause: boolean;
  canNext: boolean;
  canPrev: boolean;
  canSeek: boolean;
}

export type MediaAction = "play" | "pause" | "toggle" | "next" | "prev" | "seek";
