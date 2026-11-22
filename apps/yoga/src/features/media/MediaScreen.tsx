/** Ekran odtwarzacza: okładka rozmyta jako tło, duże przyciski 72 px, pasek postępu z seekiem. */
import { useState } from "react";
import { GlassButton, GlassSlider, Icon } from "@yoga-auto/glass-ui";
import { sendMedia, usePending } from "../../core/commands.ts";
import { formatTime, sourceLabel } from "./helpers.ts";
import { useMediaInfo, usePosition } from "./hooks.ts";

export function MediaScreen() {
  const { view, media, art } = useMediaInfo();
  const pos = usePosition(media, 400);
  const [seeking, setSeeking] = useState<number | null>(null);
  const pending = usePending("media.toggle");
  if (view !== "track" || !media)
    return (
      <div className="media-s media-s--empty">
        <Icon name="music" size={64} />
        <h2>{view === "off" ? "Moduł mediów wyłączony" : "Nic nie gra"}</h2>
        <p>
          {view === "off"
            ? "Bridge nie ma dostawcy mediów. Uruchom go na Windows 11 (SMTC) albo z --mock-media."
            : "Włącz muzykę na komputerze (Spotify, YouTube w przeglądarce…) — pojawi się tutaj."}
        </p>
      </div>
    );
  const playing = media.status === "playing";
  const dur = media.duration ?? 0;
  const shown = seeking ?? pos ?? 0;
  return (
    <div className="media-s">
      {art ? <img className="media-s__bg" src={art} alt="" draggable={false} /> : null}
      <div className="media-s__main">
        <div className="media-s__cover">
          {art ? <img src={art} alt="" draggable={false} /> : <Icon name="music" size={96} />}
        </div>
        <div className="media-s__panel">
          <div className="media-s__source">{sourceLabel(media.source)}</div>
          <div className="media-s__title">{media.title ?? "—"}</div>
          <div className="media-s__artist">{[media.artist, media.album].filter(Boolean).join(" · ")}</div>
          <div className="media-s__seek">
            <span>{formatTime(shown)}</span>
            <GlassSlider
              min={0}
              max={Math.max(1, dur)}
              step={1}
              value={Math.min(shown, Math.max(1, dur))}
              disabled={!media.canSeek || dur <= 0}
              onChange={setSeeking}
              onCommit={(v) => {
                setSeeking(null);
                void sendMedia("seek", v);
              }}
            />
            <span>{formatTime(media.duration)}</span>
          </div>
          <div className="media-s__controls">
            <GlassButton
              size="lg"
              className="media-s__btn"
              icon={<Icon name="previous" />}
              aria-label="Poprzedni"
              disabled={!media.canPrev}
              onPress={() => void sendMedia("prev")}
            />
            <GlassButton
              size="lg"
              className="media-s__btn"
              variant="filled"
              icon={<Icon name={playing ? "pause" : "play"} />}
              aria-label={playing ? "Pauza" : "Odtwarzaj"}
              pending={pending}
              disabled={!(playing ? media.canPause : media.canPlay)}
              onPress={() => void sendMedia("toggle")}
            />
            <GlassButton
              size="lg"
              className="media-s__btn"
              icon={<Icon name="next" />}
              aria-label="Następny"
              disabled={!media.canNext}
              onPress={() => void sendMedia("next")}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
