/**
 * Shell — F0 placeholder: status bar, dock, router ekranów z rejestru, Home z kafli, toasty z eventów.
 * S4: przejścia springiem, parowanie, ekran „Łączenie…”, ustawienia, kiosk/PWA, wake lock.
 */
import { useCallback, useState } from "react";
import { Dock, GlassCard, GlassProvider, Icon, StatusBar, ToastHost, type ToastProps } from "@yoga-auto/glass-ui";
import { DEFAULT_HOME_LAYOUT, getEventPresenter, getScreen, getScreens, getWidget } from "../core/registry.ts";
import { useConnection, useGameEvents, useSlow, useStatus } from "../core/store.ts";

function Home({ open }: { open(id: string): void }) {
  const items = DEFAULT_HOME_LAYOUT.map((id) => getWidget(id)).filter((w) => w !== undefined);
  return (
    <div className="home-grid">
      {items.map((w) => (
        <GlassCard key={w.id} size={w.size} {...(w.opens ? { onPress: () => open(w.opens!) } : {})}>
          <w.component size={w.size} />
        </GlassCard>
      ))}
      {items.length === 0 ? <div className="empty">Brak widgetów — S5 rejestruje je w src/features/*</div> : null}
    </div>
  );
}

function GameClock() {
  const t = useSlow((s) => s.time.game);
  const d = new Date(Date.UTC(2000, 0, 1) + t * 60_000);
  return (
    <span>
      gra {d.getUTCHours().toString().padStart(2, "0")}:{d.getUTCMinutes().toString().padStart(2, "0")}
    </span>
  );
}

function ConnectionBadge() {
  const c = useConnection();
  const st = useStatus();
  const color =
    c.state !== "open"
      ? "var(--crit)"
      : !st.connected
        ? "var(--warn)"
        : (c.rttMs ?? 99) < 30
          ? "var(--on)"
          : "var(--warn)";
  const label = c.state !== "open" ? "brak bridge'a" : !st.connected ? "gra nie działa" : `${c.rttMs ?? "–"} ms`;
  return (
    <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
      <span style={{ width: 10, height: 10, borderRadius: 5, background: color }} />
      {label}
    </span>
  );
}

export function App() {
  const [screen, setScreen] = useState("home");
  const [toasts, setToasts] = useState<ToastProps[]>([]);
  const dismiss = useCallback((id: string) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  useGameEvents((e) => {
    const content = getEventPresenter(e.kind)?.(e as never);
    if (!content) return;
    const id = `${e.kind}:${Date.now()}`;
    setToasts((t) => [
      ...t,
      {
        id,
        level: content.level ?? "info",
        title: content.title,
        body: content.body,
        icon: content.icon,
        duration: content.duration ?? 5000,
        onDismiss: dismiss,
      },
    ]);
  });

  const screens = getScreens().filter((s) => s.dock !== false);
  const dockItems = [
    { id: "home", label: "Home", icon: <Icon name="home" /> },
    ...screens.map((s) => ({ id: s.id, label: s.label, icon: <Icon name={s.icon} /> })),
  ];
  const Active = screen === "home" ? null : getScreen(screen)?.component;

  return (
    <GlassProvider tier="auto">
      <div className="shell">
        <StatusBar left={<GameClock />} right={<ConnectionBadge />} />
        <div className="shell__body">
          <Dock items={dockItems} active={screen} onSelect={setScreen} />
          <main className="shell__content">{Active ? <Active /> : <Home open={setScreen} />}</main>
        </div>
        <ToastHost toasts={toasts} />
      </div>
    </GlassProvider>
  );
}
