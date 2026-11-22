/** Feature `media` (S6): widget Home, ekran i mini-kontrolka w pasku stanu. Ładowane przez import.meta.glob w shellu. */
import { registerScreen, registerStatusItem, registerWidget } from "../../core/registry.ts";
import { MediaScreen } from "./MediaScreen.tsx";
import { MediaStatusItem } from "./MediaStatusItem.tsx";
import { MediaWidget } from "./MediaWidget.tsx";
import "./media.css";

registerWidget({ id: "media", label: "Muzyka", size: "2x1", component: MediaWidget, opens: "media" });
registerScreen({ id: "media", label: "Muzyka", icon: "music", order: 40, component: MediaScreen });
registerStatusItem({ id: "media", side: "center", order: 50, component: MediaStatusItem });
