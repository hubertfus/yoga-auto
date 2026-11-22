/**
 * Zawartość paska stanu (40 px): czas realny + czas gry, najważniejszy alert, jakość łącza,
 * plus sloty rejestrowane przez features (`registerStatusItem` — np. mini odtwarzacz S6).
 */
import { useEffect, useState } from "react";
import { StatusBar } from "@yoga-auto/glass-ui";
import { getStatusItems } from "../core/registry.ts";
import { useAlerts, useConnection, useSlow, useStatus } from "../core/store.ts";
import { alertTitle, topAlert } from "./toasts.ts";

function RealClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 5000);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="sb-time">
      {now.getHours().toString().padStart(2, "0")}:{now.getMinutes().toString().padStart(2, "0")}
    </span>
  );
}

function GameClock() {
  const t = useSlow((s) => s.time.game);
  const status = useStatus();
  if (!status.connected) return null;
  const m = Math.floor(t) % 1440;
  return (
    <span className="sb-muted">
      gra{" "}
      {Math.floor(m / 60)
        .toString()
        .padStart(2, "0")}
      :{(m % 60).toString().padStart(2, "0")}
    </span>
  );
}

function AlertCenter() {
  const alert = topAlert(useAlerts());
  if (!alert) return null;
  return (
    <span className="sb-alert" data-level={alert.level} role="status">
      ⚠ {alertTitle(alert)}
    </span>
  );
}

/** Zielony < 30 ms, żółty < 80, czerwony ≥ 80 albo brak łącza (PROTOCOL.md §2.6). */
export function linkQuality(rttMs: number | null): "good" | "fair" | "poor" {
  if (rttMs == null) return "poor";
  return rttMs < 30 ? "good" : rttMs < 80 ? "fair" : "poor";
}

function ConnectionBadge() {
  const c = useConnection();
  const st = useStatus();
  let tone: "good" | "fair" | "poor" | "off";
  let label: string;
  if (c.state !== "open") {
    tone = "poor";
    label = c.state === "unauthorized" ? "niesparowano" : "brak bridge'a";
  } else if (!st.connected) {
    tone = "fair";
    label = "gra nie działa";
  } else {
    tone = linkQuality(c.rttMs);
    label = c.rttMs == null ? "…" : `${c.rttMs} ms`;
  }
  return (
    <span className="sb-conn" data-tone={tone}>
      <span className="sb-dot" />
      {label}
    </span>
  );
}

function Slots({ side }: { side: "left" | "center" | "right" }) {
  return (
    <>
      {getStatusItems(side).map((i) => (
        <i.component key={i.id} />
      ))}
    </>
  );
}

export function ShellStatusBar() {
  return (
    <StatusBar
      left={
        <span className="sb-group">
          <RealClock />
          <GameClock />
          <Slots side="left" />
        </span>
      }
      center={
        <span className="sb-group">
          <AlertCenter />
          <Slots side="center" />
        </span>
      }
      right={
        <span className="sb-group">
          <Slots side="right" />
          <ConnectionBadge />
        </span>
      }
    />
  );
}
