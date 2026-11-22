/**
 * „Gra nie działa”: bridge odpowiada, ale gra/plugin nie wysyła telemetrii (`status.connected=false`).
 * Pokazywany jako nakładka na wyszarzoną zawartość (ostatnie wartości), z ustawieniami nadal dostępnymi.
 */
import { GlassPanel } from "@yoga-auto/glass-ui";
import { useConnection, useStatus } from "../../core/store.ts";

export function GameOffScreen() {
  const status = useStatus();
  const conn = useConnection();
  const source = status.source === "mock" ? "mock" : status.source === "replay" ? "replay" : "gra";
  return (
    <div className="center-screen gameoff" role="alert">
      <GlassPanel className="center-card">
        <div className="gameoff__icon" aria-hidden>
          ⏻
        </div>
        <h1 className="center-title">Gra nie działa</h1>
        <p className="center-hint">
          Bridge jest połączony, ale {source === "gra" ? "Euro Truck Simulator 2" : `źródło „${source}”`} nie wysyła
          danych. Uruchom grę z włączonym pluginem telemetrii i załaduj profil — ekran wróci sam.
        </p>
        <dl className="kv">
          <dt>Bridge</dt>
          <dd>
            {conn.hello ? `${conn.hello.server.name} ${conn.hello.server.version}` : "—"} ({conn.serverHost ?? "—"})
          </dd>
          <dt>Źródło</dt>
          <dd>{status.source}</dd>
          <dt>Opóźnienie</dt>
          <dd>{conn.rttMs != null ? `${conn.rttMs} ms` : "—"}</dd>
        </dl>
      </GlassPanel>
    </div>
  );
}
