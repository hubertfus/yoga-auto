/** Mapa (S8, M4): ekran `map`, widget GPS na Home oraz tło ekranu `nav` (przez registry). Trasa GPS z bridge'a. */
import { useRef, useState, type ComponentType } from "react";
import { GlassButton, Icon } from "@yoga-auto/glass-ui";
import { getScreen, registerScreen, registerWidget } from "../../core/registry.ts";
import { useConnectionSelect, useRoute } from "../../core/store.ts";
import { DestinationSheet, NextManeuver, RouteTargetBar, labelForPoint, loadPlaces, sendRouteTarget } from "../route/index.tsx";
import { MapView, loadViewMode, type MapControls } from "./MapView.tsx";
import "maplibre-gl/dist/maplibre-gl.css";
import "./map.css";

function MapScreen() {
  const controls = useRef<MapControls | null>(null);
  const [follow, setFollow] = useState(true);
  const [headingUp, setHeadingUp] = useState(() => loadViewMode("screen").headingUp);
  const [tilt, setTilt] = useState(() => loadViewMode("screen").tilt);
  const [searchOpen, setSearchOpen] = useState(false);
  const [pick, setPick] = useState<{ x: number; z: number; left: number; top: number; label: string } | null>(null);
  const canRoute = useConnectionSelect((c) => c.hello?.capabilities.route ?? false);
  const route = useRoute();
  const onLongPress = (p: { x: number; z: number; left: number; top: number }) => {
    if (!canRoute) return;
    setPick({ ...p, label: "Punkt na mapie" });
    void loadPlaces().then((places) =>
      setPick((cur) => (cur && cur.x === p.x && cur.z === p.z ? { ...cur, label: labelForPoint(places, p.x, p.z) } : cur)),
    );
  };
  return (
    <div className="map-screen" data-testid="map-screen">
      <MapView
        controlsRef={controls}
        zoom={14}
        zoomKey="screen"
        onFollowChange={setFollow}
        onHeadingUpChange={setHeadingUp}
        onTiltChange={setTilt}
        onLongPress={onLongPress}
      />
      <RouteOverlay />
      {pick ? (
        <div className="map-pick" style={{ left: pick.left, top: pick.top }} data-testid="map-pick">
          <div className="map-pick__label">{pick.label}</div>
          <div className="map-pick__actions">
            <GlassButton size="md" label="Anuluj" onPress={() => setPick(null)} />
            <GlassButton
              size="md"
              variant="filled"
              icon={<Icon name="navigation" />}
              label="Nawiguj tutaj"
              onPress={() => {
                sendRouteTarget({ x: pick.x, z: pick.z, label: pick.label });
                setPick(null);
              }}
              data-testid="map-pick-go"
            />
          </div>
        </div>
      ) : null}
      <DestinationSheet open={searchOpen} onClose={() => setSearchOpen(false)} />
      <div className="map-controls">
        {canRoute ? (
          <GlassButton size="lg" icon={<Icon name="search" />} aria-label="Wybierz cel" onPress={() => setSearchOpen(true)} data-testid="map-search" />
        ) : null}
        {route?.manual ? (
          <GlassButton
            size="lg"
            icon={<Icon name="close" />}
            aria-label="Zakończ nawigację"
            tone="crit"
            onPress={() => void sendRouteTarget(null)}
            data-testid="map-route-clear"
          />
        ) : null}
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
          label="3D"
          aria-label="Widok 3D"
          active={tilt}
          onPress={() => controls.current?.toggleTilt()}
          data-testid="map-tilt"
        />
        <GlassButton
          size="lg"
          icon={<Icon name="navigation" />}
          aria-label="Podążaj za pojazdem"
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
      {compact ? null : <RouteTargetBar />}
      <NextManeuver compact={compact} />
    </div>
  );
}

/**
 * Mapa bez gestów (kafel Home, tło nawigacji) z przyciskami: obrót wg kierunku jazdy, widok 3D, −/+.
 * Tryb i zoom zapamiętane per `viewKey`. Przyciski zatrzymują kliknięcie i przytrzymanie,
 * żeby nie otwierać ekranu mapy z kafla ani nie wchodzić w edycję układu Home.
 */
function FollowMap({
  viewKey,
  zoom,
  testid,
  className,
  bgClass,
}: {
  viewKey: string;
  zoom: number;
  testid: string;
  className: string;
  /** mapa jako tło w osobnym kontenerze (nawigacja); przyciski poza nim */
  bgClass?: string;
}) {
  const controls = useRef<MapControls | null>(null);
  const [headingUp, setHeadingUp] = useState(() => loadViewMode(viewKey).headingUp);
  const [tilt, setTilt] = useState(() => loadViewMode(viewKey).tilt);
  const stop = (e: { stopPropagation(): void }) => e.stopPropagation();
  const map = (
    <MapView
      interactive={false}
      zoom={zoom}
      zoomKey={viewKey}
      controlsRef={controls}
      onHeadingUpChange={setHeadingUp}
      onTiltChange={setTilt}
    />
  );
  return (
    <>
      {bgClass ? (
        <div className={bgClass} aria-hidden="true">
          {map}
        </div>
      ) : (
        map
      )}
      <div className={`map-zoom ${className}`} onClick={stop} onPointerDown={stop} onKeyDown={stop} data-testid={testid}>
        <GlassButton
          size="sm"
          icon={<Icon name="compass" />}
          aria-label="Kierunek jazdy w górę"
          active={headingUp}
          onPress={() => controls.current?.toggleHeadingUp()}
          data-testid={`${testid}-heading`}
        />
        <GlassButton
          size="sm"
          label="3D"
          aria-label="Widok 3D"
          active={tilt}
          onPress={() => controls.current?.toggleTilt()}
          data-testid={`${testid}-tilt`}
        />
        <GlassButton size="sm" icon={<Icon name="minus" />} aria-label="Oddal" onPress={() => controls.current?.zoomBy(-1)} data-testid={`${testid}-out`} />
        <GlassButton size="sm" icon={<Icon name="plus" />} aria-label="Przybliż" onPress={() => controls.current?.zoomBy(1)} data-testid={`${testid}-in`} />
      </div>
    </>
  );
}

/** Widget Home: mini-mapa (bez gestów, zawsze za ciężarówką) z trasą, najbliższym manewrem, obrotem, 3D i zoomem. */
function MapWidget() {
  return (
    <div className="map-widget" data-testid="map-widget">
      <FollowMap viewKey="home" zoom={13} testid="map-widget-zoom" className="map-zoom--widget" />
      <RouteOverlay compact />
    </div>
  );
}

/** Opakowuje istniejący ekran `nav` (S5): mapa w tle (nieinteraktywna, zawsze follow), panele na wierzchu. */
function withMapBackground(Inner: ComponentType): ComponentType {
  function NavWithMap() {
    return (
      <div className="map-nav-wrap" data-testid="nav-map-bg">
        <FollowMap viewKey="nav" zoom={13.5} testid="nav-map-zoom" className="map-zoom--nav" bgClass="map-nav-bg" />
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
