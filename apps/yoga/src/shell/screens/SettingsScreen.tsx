/** Ustawienia: jednostki, wygląd (motyw, noc, tier szkła, jasność), dane (fastHz, reset tripu), połączenie. */
import { useState, type ReactNode } from "react";
import {
  GlassButton,
  GlassPanel,
  GlassSegmented,
  GlassSlider,
  GlassToggle,
  Sheet,
  usePerfTier,
  type PerfTier,
} from "@yoga-auto/glass-ui";
import { client, getToken, setToken } from "../../core/client.ts";
import { tripReset, usePending } from "../../core/commands.ts";
import { resetSettings, updateSettings, useSettings, type FastHz } from "../../core/settings.ts";
import { useConnection, useStatus } from "../../core/store.ts";
import { resetLayout } from "../homeLayout.ts";

declare const __APP_VERSION__: string;

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="setting-row">
      <div className="setting-row__label">
        <div>{label}</div>
        {hint ? <div className="setting-row__hint">{hint}</div> : null}
      </div>
      <div className="setting-row__control">{children}</div>
    </div>
  );
}

const TIERS: { value: PerfTier | "auto"; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "ultra", label: "Ultra" },
  { value: "high", label: "High" },
  { value: "lite", label: "Lite" },
  { value: "flat", label: "Flat" },
];

export function SettingsScreen() {
  const s = useSettings();
  const conn = useConnection();
  const status = useStatus();
  const perf = usePerfTier();
  const tripPending = usePending("trip.reset");
  const [confirmTrip, setConfirmTrip] = useState(false);

  const setFastHz = (hz: FastHz) => {
    updateSettings({ fastHz: hz });
    client.subscribe({ fastHz: hz });
  };

  return (
    <div className="settings">
      <GlassPanel title="Jednostki">
        <Row label="Prędkość">
          <GlassSegmented
            value={s.units.speed}
            onChange={(v) => updateSettings({ units: { speed: v } })}
            options={[
              { value: "kmh", label: "km/h" },
              { value: "mph", label: "mph" },
            ]}
          />
        </Row>
        <Row label="Temperatura">
          <GlassSegmented
            value={s.units.temp}
            onChange={(v) => updateSettings({ units: { temp: v } })}
            options={[
              { value: "c", label: "°C" },
              { value: "f", label: "°F" },
            ]}
          />
        </Row>
        <Row label="Objętość">
          <GlassSegmented
            value={s.units.volume}
            onChange={(v) => updateSettings({ units: { volume: v } })}
            options={[
              { value: "l", label: "litry" },
              { value: "gal", label: "galony" },
            ]}
          />
        </Row>
      </GlassPanel>

      <GlassPanel title="Wygląd">
        <Row label="Motyw" hint="Auto: ciemny i nocny od 20:00 do 6:00 czasu gry, w dzień jasny">
          <GlassSegmented
            value={s.theme}
            onChange={(v) => updateSettings({ theme: v })}
            options={[
              { value: "light", label: "Jasny" },
              { value: "dark", label: "Ciemny" },
              { value: "auto", label: "Auto (gra)" },
            ]}
          />
        </Row>
        <Row label="Tryb nocny" hint="Przyciemnia i ociepla barwy">
          <GlassToggle checked={s.night} onChange={(v) => updateSettings({ night: v })} />
        </Row>
        <Row
          label="Efekt szkła"
          hint={`Aktywny: ${perf.tier}${perf.stats ? ` · ${perf.stats.fps.toFixed(0)} fps (p95 ${perf.stats.p95.toFixed(1)} ms)` : ""}`}
        >
          <GlassSegmented value={s.tier} onChange={(v) => updateSettings({ tier: v })} options={TIERS} />
        </Row>
        <Row label="Jasność" hint="Programowe przyciemnienie ekranu">
          <GlassSlider
            min={0.3}
            max={1}
            step={0.05}
            value={s.brightness}
            onChange={(v) => updateSettings({ brightness: v })}
          />
        </Row>
        <Row label="Dźwięk alertów">
          <GlassToggle checked={s.sounds} onChange={(v) => updateSettings({ sounds: v })} />
        </Row>
      </GlassPanel>

      <GlassPanel title="Dane">
        <Row label="Odświeżanie telemetrii" hint="Wyższe = płynniejsze wskazówki, więcej ruchu w Wi-Fi">
          <GlassSegmented
            value={String(s.fastHz) as "15" | "30" | "60"}
            onChange={(v) => setFastHz(Number(v) as FastHz)}
            options={[
              { value: "15", label: "15 Hz" },
              { value: "30", label: "30 Hz" },
              { value: "60", label: "60 Hz" },
            ]}
          />
        </Row>
        <Row label="Komputer pokładowy" hint="Zeruje dystans, spalanie i czas jazdy">
          <GlassButton
            size="md"
            label="Resetuj trasę"
            pending={tripPending}
            disabled={!status.connected}
            onPress={() => setConfirmTrip(true)}
          />
        </Row>
        <Row label="Układ ekranu głównego" hint="Przywraca domyślne kafle">
          <GlassButton size="md" label="Przywróć domyślny" onPress={() => resetLayout()} />
        </Row>
      </GlassPanel>

      <GlassPanel title="Połączenie">
        <dl className="kv">
          <dt>Bridge</dt>
          <dd>
            {conn.hello ? `${conn.hello.server.name} ${conn.hello.server.version}` : "—"} ({conn.serverHost ?? "—"})
          </dd>
          <dt>Protokół</dt>
          <dd>{conn.hello ? `${conn.hello.protocol.major}.${conn.hello.protocol.minor}` : "—"}</dd>
          <dt>Stan</dt>
          <dd>{conn.state}</dd>
          <dt>Opóźnienie</dt>
          <dd>{conn.rttMs != null ? `${conn.rttMs} ms` : "—"}</dd>
          <dt>Źródło danych</dt>
          <dd>
            {status.source}
            {status.connected ? "" : " (brak danych)"}
          </dd>
          <dt>Gra</dt>
          <dd>{status.game ? `${status.game.toUpperCase()} ${status.gameVersion ?? ""}` : "—"}</dd>
          <dt>Sterowanie</dt>
          <dd>{status.inputEnabled ? (status.inputActive ? "aktywne" : "włączone, czeka na grę") : "wyłączone"}</dd>
          <dt>Aplikacja</dt>
          <dd>{typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev"}</dd>
        </dl>
        <div className="setting-actions">
          <GlassButton size="md" label="Połącz ponownie" onPress={() => client.reconnect()} />
          <GlassButton
            size="md"
            label="Sparuj ponownie"
            disabled={!getToken()}
            onPress={() => {
              setToken(null);
              client.reconnect();
            }}
          />
          <GlassButton size="md" label="Przywróć ustawienia" onPress={() => resetSettings()} />
        </div>
      </GlassPanel>

      <Sheet open={confirmTrip} onClose={() => setConfirmTrip(false)} title="Zresetować komputer pokładowy?">
        <p className="center-hint">Dystans, zużycie paliwa i czas jazdy wrócą do zera. Tego nie można cofnąć.</p>
        <div className="setting-actions">
          <GlassButton size="lg" label="Anuluj" onPress={() => setConfirmTrip(false)} />
          <GlassButton
            size="lg"
            variant="filled"
            tone="crit"
            label="Resetuj"
            onPress={() => {
              setConfirmTrip(false);
              void tripReset();
            }}
          />
        </div>
      </Sheet>
    </div>
  );
}
