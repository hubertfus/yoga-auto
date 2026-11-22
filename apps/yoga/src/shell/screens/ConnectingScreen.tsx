/** „Łączenie…” — gdy WS nie działa. Dane z /api/info pokazują, czy bridge w ogóle żyje (HTTP) i jaką ma wersję. */
import { useEffect, useState } from "react";
import { GlassButton, GlassPanel } from "@yoga-auto/glass-ui";
import { PROTOCOL_VERSION, type InfoRes } from "@yoga-auto/protocol";
import { client } from "../../core/client.ts";
import { fetchInfo } from "../../core/pairing.ts";
import { store, useConnection } from "../../core/store.ts";

const INFO_POLL_MS = 2000;

export function ConnectingScreen() {
  const conn = useConnection();
  const [info, setInfo] = useState<InfoRes | null | undefined>(undefined);
  const [now, setNow] = useState(() => performance.now());

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      const r = await fetchInfo();
      if (!alive) return;
      setInfo(r);
      // HTTP już odpowiada, a WS czeka na backoff → nie marnuj czasu (powrót bridge'a < 5 s)
      if (r && store.conn.state === "closed") client.reconnect();
    };
    void poll();
    const id = setInterval(poll, INFO_POLL_MS);
    const tick = setInterval(() => setNow(performance.now()), 250);
    return () => {
      alive = false;
      clearInterval(id);
      clearInterval(tick);
    };
  }, []);

  const mismatch = conn.state === "mismatch" || (info && info.protocol.major !== PROTOCOL_VERSION);
  const retryIn = conn.nextRetryAt ? Math.max(0, Math.ceil((conn.nextRetryAt - now) / 1000)) : null;

  let title = "Łączenie z bridge'em…";
  let hint = "Sprawdzam, czy bridge odpowiada w sieci.";
  if (mismatch) {
    title = "Niezgodna wersja";
    hint = `Bridge i aplikacja mają różne wersje protokołu (aplikacja: ${PROTOCOL_VERSION}${info ? `, bridge: ${info.protocol.major}` : ""}). Zaktualizuj bridge albo odśwież aplikację.`;
  } else if (info === null) {
    title = "Nie widzę bridge'a";
    hint = "Uruchom bridge na komputerze z grą i upewnij się, że oba urządzenia są w tej samej sieci Wi-Fi.";
  } else if (info) {
    title = "Łączenie z grą…";
    hint = `Bridge ${info.name} ${info.version} odpowiada. Nawiązuję połączenie na żywo.`;
  }

  return (
    <div className="center-screen">
      <GlassPanel className="center-card">
        <div className="spinner" data-stalled={info === null || undefined} aria-hidden />
        <h1 className="center-title">{title}</h1>
        <p className="center-hint">{hint}</p>
        <dl className="kv">
          <dt>Adres</dt>
          <dd>{location.host}</dd>
          <dt>Bridge (HTTP)</dt>
          <dd>{info === undefined ? "sprawdzam…" : info ? `${info.name} ${info.version}` : "brak odpowiedzi"}</dd>
          <dt>Próba</dt>
          <dd>
            {conn.attempt || 1}
            {conn.state === "closed" && retryIn != null ? ` · kolejna za ${retryIn} s` : ""}
          </dd>
        </dl>
        <GlassButton size="lg" label="Spróbuj teraz" onPress={() => client.reconnect()} />
      </GlassPanel>
    </div>
  );
}
