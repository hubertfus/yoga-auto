/** Kafel Home 2×1: okładka, tytuł/artysta, play/pause i następny; tap w kafel otwiera ekran `media`. */
import { GlassButton, Icon } from "@yoga-auto/glass-ui";
import { sendMedia, usePending } from "../../core/commands.ts";
import type { WidgetProps } from "../../core/registry.ts";
import { progressFraction } from "./helpers.ts";
import { useMediaInfo, usePosition } from "./hooks.ts";

export function MediaWidget({ size }: WidgetProps) {
  const { view, media, art } = useMediaInfo();
  const pos = usePosition(media, 1000);
  const pending = usePending("media.toggle");
  if (view !== "track" || !media)
    return (
      <div className="media-w media-w--empty" data-size={size}>
        <Icon name="music" />
        <span>{view === "off" ? "Moduł mediów wyłączony" : "Nic nie gra"}</span>
      </div>
    );
  const playing = media.status === "playing";
  return (
    <div className="media-w" data-size={size}>
      <div className="media-w__cover">{art ? <img src={art} alt="" draggable={false} /> : <Icon name="music" />}</div>
      <div className="media-w__text">
        <div className="media-w__title">{media.title ?? "—"}</div>
        <div className="media-w__artist">{media.artist ?? media.album ?? ""}</div>
        <div className="media-w__bar">
          <i style={{ width: `${progressFraction(pos, media.duration) * 100}%` }} />
        </div>
      </div>
      <div className="media-w__ctl" onClick={(e) => e.stopPropagation()}>
        <GlassButton
          size="md"
          variant="filled"
          icon={<Icon name={playing ? "pause" : "play"} />}
          aria-label={playing ? "Pauza" : "Odtwarzaj"}
          pending={pending}
          disabled={!(playing ? media.canPause : media.canPlay)}
          onPress={() => void sendMedia("toggle")}
        />
        <GlassButton
          size="md"
          icon={<Icon name="next" />}
          aria-label="Następny"
          disabled={!media.canNext}
          onPress={() => void sendMedia("next")}
        />
      </div>
    </div>
  );
}
