/**
 * Shell: bramka połączenia (łączenie / parowanie), status bar, dock, router ze springami,
 * Home, ToastHost, nakładka jasności, kiosk (blokady gestów, wake lock), PWA.
 */
import { useEffect, useSyncExternalStore } from "react";
import { Dock, GlassProvider, Icon } from "@yoga-auto/glass-ui";
import { client } from "../core/client.ts";
import { HOME, navigate, useRoute } from "../core/router.ts";
import { getScreen, getScreens, registerScreen } from "../core/registry.ts";
import { useSettings } from "../core/settings.ts";
import { useConnectionSelect, useStatus } from "../core/store.ts";
import { Home } from "./Home.tsx";
import { Transition } from "./ScreenHost.tsx";
import { ShellStatusBar } from "./StatusBarContent.tsx";
import { ToastHost } from "./Toasts.tsx";
import { devForce, installDevMocks } from "./devTools.ts";
import { gateFor, OFFLINE_OK_SCREENS } from "./gate.ts";
import { installGestureGuards, installHoldSafety, installWakeLock } from "./kiosk.ts";
import { registerServiceWorker } from "./pwa.ts";
import { ConnectingScreen } from "./screens/ConnectingScreen.tsx";
import { GameOffScreen } from "./screens/GameOffScreen.tsx";
import { PairingScreen } from "./screens/PairingScreen.tsx";
import { SettingsScreen } from "./screens/SettingsScreen.tsx";
import "./shell.css";

registerScreen({ id: "settings", label: "Ustawienia", icon: "settings", order: 1000, component: SettingsScreen });
installDevMocks();

const portraitQuery = typeof window !== "undefined" ? window.matchMedia("(orientation: portrait)") : null;
const subscribeOrientation = (l: () => void) => {
  portraitQuery?.addEventListener("change", l);
  return () => portraitQuery?.removeEventListener("change", l);
};
const useIsPortrait = () => useSyncExternalStore(subscribeOrientation, () => portraitQuery?.matches ?? false);

function ScreenContent({ route, gameOff }: { route: string; gameOff: boolean }) {
  const Active = route === HOME ? Home : (getScreen(route)?.component ?? Home);
  const blocked = gameOff && !OFFLINE_OK_SCREENS.has(route);
  return (
    <div className="content" data-gameoff={blocked || undefined}>
      <div className="content__inner" inert={blocked || undefined}>
        <Active />
      </div>
      {blocked ? <GameOffScreen /> : null}
    </div>
  );
}

export function App() {
  const settings = useSettings();
  const route = useRoute();
  const connState = useConnectionSelect((c) => c.state);
  const status = useStatus();
  const portrait = useIsPortrait();

  useEffect(() => {
    const offs = [installGestureGuards(), installHoldSafety(), installWakeLock()];
    registerServiceWorker();
    return () => offs.forEach((off) => off());
  }, []);

  useEffect(() => {
    client.subscribe({ fastHz: settings.fastHz });
  }, [settings.fastHz]);

  const force = devForce();
  const gate = force === "pairing" ? "pairing" : force === "connecting" ? "connecting" : gateFor(connState);
  const gameOff = force === "gameoff" || (gate === "ready" && !status.connected);

  const screens = getScreens().filter((s) => s.dock !== false);
  const dockItems = [
    { id: HOME, label: "Home", icon: <Icon name="home" /> },
    ...screens.map((s) => ({ id: s.id, label: s.label, icon: <Icon name={s.icon} /> })),
  ];

  return (
    <GlassProvider tier={settings.tier} theme={settings.theme} night={settings.night}>
      <div className="shell" data-orient={portrait ? "portrait" : "landscape"}>
        <ShellStatusBar />
        {gate === "ready" ? (
          <div className="shell__body">
            <Dock items={dockItems} active={route} onSelect={navigate} position={portrait ? "bottom" : "left"} />
            <main className="shell__content">
              <Transition id={route}>
                <ScreenContent route={route} gameOff={gameOff} />
              </Transition>
            </main>
          </div>
        ) : (
          <main className="shell__body shell__body--gate">
            <Transition id={gate}>{gate === "pairing" ? <PairingScreen /> : <ConnectingScreen />}</Transition>
          </main>
        )}
        <ToastHost />
        <div className="dim-overlay" style={{ opacity: 1 - settings.brightness }} aria-hidden />
      </div>
    </GlassProvider>
  );
}
