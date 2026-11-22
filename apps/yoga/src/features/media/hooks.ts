import { useEffect, useRef, useState } from "react";
import type { MediaState } from "@yoga-auto/protocol";
import { getToken } from "../../core/client.ts";
import { useConnectionSelect, useMedia } from "../../core/store.ts";
import { artSrc, interpolate, mediaView, type MediaView } from "./helpers.ts";

export interface MediaInfo {
  view: MediaView;
  media: MediaState | null;
  /** URL okładki z tokenem albo null */
  art: string | null;
}

export function useMediaInfo(): MediaInfo {
  const capable = useConnectionSelect((c) => c.hello?.capabilities.media === true);
  const media = useMedia();
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
