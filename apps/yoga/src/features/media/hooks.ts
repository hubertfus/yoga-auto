import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { MediaState } from "@yoga-auto/protocol";
import { client, getToken } from "../../core/client.ts";
import { store, useConnectionSelect } from "../../core/store.ts";
import { artSrc, interpolate, mediaView, type MediaView } from "./helpers.ts";

export interface MediaInfo {
  view: MediaView;
  media: MediaState | null;
  /** URL okładki z tokenem albo null */
  art: string | null;
}

/**
 * Własna kopia ostatniego `media`: bridge rozsyła co kilka sekund keyframe `snapshot`, w którym `media` = null
 * (zob. docs/proposals/s6-snapshot-media.md) i zerowałby store. Kopia jest czyszczona tylko przy nowej sesji bridge'a.
 */
let latest: MediaState | null = store.state.media;
let session = store.conn.session;
const listeners = new Set<() => void>();
client.onMessage((msg) => {
  if (msg.t === "hello" && msg.session !== session) {
    session = msg.session;
    latest = null;
  } else if (msg.t === "media") latest = msg.media;
  else return;
  listeners.forEach((l) => l());
});
const subscribeMedia = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));
const useLatestMedia = (): MediaState | null => useSyncExternalStore(subscribeMedia, () => latest);

export function useMediaInfo(): MediaInfo {
  const capable = useConnectionSelect((c) => c.hello?.capabilities.media === true);
  const media = useLatestMedia();
  return { view: mediaView(capable, media), media, art: artSrc(media?.artUrl ?? null, getToken()) };
}

/** Pozycja odtwarzania odświeżana co `everyMs`, liczona od odebrania stanu na kliencie. */
export function usePosition(media: MediaState | null, everyMs = 500): number | null {
  const receivedAt = useRef(performance.now());
  const [pos, setPos] = useState<number | null>(() => (media ? interpolate(media, 0) : null));
  useEffect(() => {
    receivedAt.current = performance.now();
    if (!media) return void setPos(null);
    const tick = () => setPos(interpolate(media, performance.now() - receivedAt.current));
    tick();
    if (media.status !== "playing") return;
    const id = setInterval(tick, everyMs);
    return () => clearInterval(id);
  }, [media, everyMs]);
  return pos;
}
