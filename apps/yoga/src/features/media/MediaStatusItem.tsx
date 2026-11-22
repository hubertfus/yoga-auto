/** Mini-kontrolka w StatusBar: tytuł + play/pauza (tylko gdy jest utwór). */
import { Icon } from "@yoga-auto/glass-ui";
import { sendMedia } from "../../core/commands.ts";
import { navigate } from "../../core/router.ts";
import { useMediaInfo } from "./hooks.ts";

export function MediaStatusItem() {
  const { view, media } = useMediaInfo();
  if (view !== "track" || !media) return null;
  const playing = media.status === "playing";
  return (
    <span className="media-sb">
      <button type="button" className="media-sb__title" onClick={() => navigate("media")}>
        <Icon name="music" size={14} /> {media.title}
      </button>
      <button
        type="button"
        className="media-sb__btn"
        aria-label={playing ? "Pauza" : "Odtwarzaj"}
        onClick={() => void sendMedia("toggle")}
      >
        <Icon name={playing ? "pause" : "play"} size={16} />
      </button>
    </span>
  );
}
