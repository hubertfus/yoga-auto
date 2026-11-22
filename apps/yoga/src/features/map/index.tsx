/** Mapa (S8, M4): ekran `map`, widget GPS na Home oraz tło ekranu `nav` (przez registry). Trasa GPS z bridge'a. */
import { useRef, useState, type ComponentType } from "react";
import { GlassButton, Icon } from "@yoga-auto/glass-ui";
import { getScreen, registerScreen, registerWidget } from "../../core/registry.ts";
import { useRoute } from "../../core/store.ts";
import { NextManeuver } from "../route/index.tsx";
import { MapView, type MapControls } from "./MapView.tsx";
import "maplibre-gl/dist/maplibre-gl.css";
import "./map.css";

function MapScreen() {
  const controls = useRef<MapControls | null>(null);
  const [follow, setFollow] = useState(true);
  const [headingUp, setHeadingUp] = useState(false);
  return (
    <div className="map-screen" data-testid="map-screen">
      <MapView controlsRef={controls} onFollowChange={setFollow} onHeadingUpChange={setHeadingUp} />
      <RouteOverlay />
      <div className="map-controls">
        <GlassButton
          size="lg"
          icon={<Icon name="plus" />}
          aria-label="Przybliż"
          onPress={() => controls.current?.zoomBy(1)}
          data-testid="map-zoom-in"
        />
        <GlassButton
          size="lg"
          icon={<Icon name="minus" />}
          aria-label="Oddal"
          onPress={() => controls.current?.zoomBy(-1)}
          data-testid="map-zoom-out"
        />
        <GlassButton
          size="lg"
          icon={<Icon name="compass" />}
          aria-label="Kierunek jazdy w górę"
          active={headingUp}
          onPress={() => controls.current?.toggleHeadingUp()}
          data-testid="map-heading-up"
        />
        <GlassButton
          size="lg"
          icon={<Icon name="navigation" />}
          aria-label="Podążaj za ciężarówką"
          active={follow}
          tone="accent"
          onPress={() => controls.current?.recenter()}
          data-testid="map-follow"
        />
      </div>
    </div>
  );
}

/** Panel najbliższego manewru w rogu mapy (tylko gdy jest trasa). */
function RouteOverlay({ compact = false }: { compact?: boolean }) {
  const route = useRoute();
  if (!route) return null;
  return (
    <div className="map-route-overlay" data-compact={compact || undefined}>
      <NextManeuver compact={compact} />
    </div>
  );
}

/** Widget Home: mini-mapa (bez gestów, zawsze za ciężarówką) z trasą i najbliższym manewrem. */
function MapWidget() {
  return (
    <div className="map-widget" data-testid="map-widget">
      <MapView interactive={false} zoom={11.5} />
      <RouteOverlay compact />
    </div>
  );
}

/** Opakowuje istniejący ekran `nav` (S5): mapa w tle (nieinteraktywna, zawsze follow), panele na wierzchu. */
function withMapBackground(Inner: ComponentType): ComponentType {
  function NavWithMap() {
    return (
      <div className="map-nav-wrap" data-testid="nav-map-bg">
        <div className="map-nav-bg" aria-hidden="true">
          <MapView interactive={false} zoom={12} />
        </div>
        <div className="map-nav-fg">
          <Inner />
        </div>
      </div>
    );
  }
  return NavWithMap;
}

registerScreen({ id: "map", label: "Mapa", icon: "map", order: 25, component: MapScreen });
registerWidget({ id: "map", label: "Mapa GPS", size: "2x2", sizes: ["2x2", "2x1", "4x2"], component: MapWidget, opens: "map" });

// Moduły features ładują się alfabetycznie, `map` przed `navigation` — ekran `nav` (S5) rejestruje się później,
// więc owijamy go po załadowaniu wszystkich (setTimeout 0). Bez edycji cudzych plików; patrz docs/proposals/s8-nav-background.md.
let wrapped = false;
setTimeout(() => {
  const nav = getScreen("nav");
  if (wrapped || !nav) return;
  wrapped = true;
  registerScreen({ ...nav, component: withMapBackground(nav.component) });
}, 0);
