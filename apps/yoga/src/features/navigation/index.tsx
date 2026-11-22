/** Nawigacja i zlecenie: widgety `nav`, `job` oraz ekran `nav` (manewry trasy GPS + dystans/ETA z gry + limit + zlecenie). */
import { GlassPanel, Icon } from "@yoga-auto/glass-ui";
import type { JobConfig } from "@yoga-auto/protocol";
import { registerScreen, registerWidget } from "../../core/registry.ts";
import { useConfig, useSlow } from "../../core/store.ts";
import { Bar, CardTitle, Stat } from "../_shared/shared.tsx";
import { LimitSign } from "../gauges/index.tsx";
import { MANEUVER_TEXT, ManeuverIcon, ManeuverList, NextManeuver, formatManeuverDistance, useRouteProgress } from "../route/index.tsx";
import {
  formatArrival,
  formatDistance,
  formatDuration,
  formatGameTime,
  formatLimit,
  formatMass,
  formatMinutes,
  formatMoney,
  formatPercent,
  useUnits,
} from "../units/index.ts";

/** Minuty gry do terminu: dodatnie = zostało, ujemne = spóźnienie; null = brak terminu. */
export const minutesToDeadline = (job: JobConfig | null, gameNow: number): number | null =>
  job && job.deliveryTime !== null ? job.deliveryTime - gameNow : null;

export function NavSummary({ large }: { large?: boolean }) {
  const u = useUnits();
  const distance = useSlow((s) => s.nav.distance);
  const time = useSlow((s) => s.nav.time);
  const gameNow = useSlow((s) => s.time.game);
  const hasRoute = distance !== null;
  return (
    <>
      <div className={large ? undefined : "ft-big"} style={large ? { font: "var(--t-display)" } : undefined} data-testid="nav-distance">
        {hasRoute ? formatDistance(distance, u) : "–"}
      </div>
      {hasRoute ? (
        <div className="ft-dim ft-mid" data-testid="nav-eta">
          <div>ETA {formatDuration(time)}</div>
          <div className="ft-dimmer">→ {formatArrival(gameNow, time)}</div>
        </div>
      ) : (
        <div className="ft-dimmer">Brak trasy</div>
      )}
    </>
  );
}

function NavWidget() {
  const progress = useRouteProgress(1);
  const imperial = useUnits().speed === "mph";
  const cur = progress?.upcoming[0];
  return (
    <div className="ft-root">
      <CardTitle icon={<Icon name="navigation" size={18} />}>Nawigacja</CardTitle>
      <div className="ft-grow" />
      {cur ? (
        <div className="ft-root" style={{ height: "auto", gap: 2 }} data-testid="nav-widget-maneuver">
          <span style={{ color: "var(--accent)" }}>
            <ManeuverIcon kind={cur.maneuver.kind} angle={cur.maneuver.angle} size={40} />
          </span>
          <div className="ft-mid" style={{ fontWeight: 700, whiteSpace: "nowrap" }}>
            {formatManeuverDistance(cur.distance, imperial)}
          </div>
          <div className="ft-dim" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {MANEUVER_TEXT[cur.maneuver.kind]}
          </div>
        </div>
      ) : (
        <NavSummary />
      )}
    </div>
  );
}

function JobWidget() {
  const job = useConfig((c) => c.job);
  const gameNow = useSlow((s) => s.time.game);
  const left = minutesToDeadline(job, gameNow);
  return (
    <div className="ft-root">
      <CardTitle icon={<Icon name="package" size={18} />}>Zlecenie</CardTitle>
      {job ? (
        <>
          <div className="ft-grow" />
          <div className="ft-mid" style={{ lineHeight: 1.15 }}>
            {job.source.city} <span className="ft-dimmer">→</span> {job.destination.city}
          </div>
          <div className="ft-dim">{job.cargo}</div>
          <div className="ft-spread" style={{ flexWrap: "wrap", rowGap: 0 }}>
            <span className="ft-mid" style={{ whiteSpace: "nowrap" }}>{formatMoney(job.income)}</span>
            {left !== null ? (
              <span className="ft-dim" style={left < 0 ? { color: "var(--crit)" } : undefined} data-testid="job-left">
                {left < 0 ? `−${formatMinutes(-left)}` : formatMinutes(left)}
              </span>
            ) : null}
          </div>
        </>
      ) : (
        <div className="ft-grow ft-nodata" style={{ display: "grid", placeItems: "center" }}>
          Brak zlecenia
        </div>
      )}
    </div>
  );
}

export function JobPanel() {
  const job = useConfig((c) => c.job);
  const u = useUnits();
  const gameNow = useSlow((s) => s.time.game);
  const cargoDamage = useSlow((s) => s.trailers.find((t) => t.connected)?.cargoDamage ?? s.trailers[0]?.cargoDamage ?? null);
  const rest = useSlow((s) => s.time.restStopMin);
  const left = minutesToDeadline(job, gameNow);
  return (
    <GlassPanel title="Zlecenie" tint="strong" padding={24} style={{ minWidth: 380 }}>
      {job ? (
        <div className="ft-root" style={{ gap: "var(--s-3)" }}>
          <div className="ft-dim">
            {job.cargo} · {formatMass(job.mass)}
          </div>
          <div>
            <div className="ft-mid">{job.source.city}</div>
            <div className="ft-dimmer">{job.source.company}</div>
          </div>
          <div className="ft-dim ft-mid">↓ {formatDistance(job.plannedDistanceKm * 1000, u)}</div>
          <div>
            <div className="ft-mid">{job.destination.city}</div>
            <div className="ft-dimmer">{job.destination.company}</div>
          </div>
          <div className="ft-spread" data-testid="job-deadline">
            <Stat
              label="Termin"
              value={job.deliveryTime === null ? "bez terminu" : formatGameTime(job.deliveryTime)}
              tone={left !== null && left < 0 ? "crit" : undefined}
            />
            {left !== null ? (
              <Stat label={left < 0 ? "Spóźnienie" : "Pozostało"} value={left < 0 ? formatMinutes(-left) : formatMinutes(left)} tone={left < 0 ? "crit" : undefined} />
            ) : null}
          </div>
          <div className="ft-spread">
            <Stat label="Zarobek" value={formatMoney(job.income)} />
            <Stat label="Uszkodzenie ładunku" value={formatPercent(cargoDamage, true)} tone={cargoDamage !== null && cargoDamage > 0.1 ? "warn" : undefined} />
          </div>
          <Stat
            label="Odpoczynek za"
            value={rest === null ? "–" : rest < 0 ? `−${formatMinutes(-rest)}` : formatMinutes(rest)}
            tone={rest !== null && rest <= 0 ? "crit" : rest !== null && rest <= 60 ? "warn" : undefined}
          />
          {job.cargoLoaded ? null : <div className="ft-dimmer">Ładunek jeszcze nie załadowany</div>}
        </div>
      ) : (
        <div className="ft-nodata">Brak aktywnego zlecenia</div>
      )}
    </GlassPanel>
  );
}

function NavScreen() {
  const u = useUnits();
  const limit = useSlow((s) => s.nav.speedLimit);
  const distance = useSlow((s) => s.nav.distance);
  const planned = useConfig((c) => (c.job ? c.job.plannedDistanceKm * 1000 : null));
  const progress = distance !== null && planned && planned > 0 ? 1 - Math.min(1, distance / planned) : null;
  return (
    <div className="ft-screen" style={{ flexDirection: "row", alignItems: "stretch" }}>
      <GlassPanel
        tint="strong"
        padding={24}
        style={{ width: 440, flex: "none", display: "flex", flexDirection: "column", gap: "var(--s-4)", minHeight: 0 }}
      >
        <CardTitle icon={<Icon name="navigation" size={20} />}>Nawigacja</CardTitle>
        <NextManeuver />
        <div className="ft-grow" style={{ minHeight: 0, overflow: "auto", overscrollBehavior: "contain" }}>
          <ManeuverList count={6} />
        </div>
        {progress !== null ? <Bar value={progress} /> : null}
        <div className="ft-spread">
          <div>
            <NavSummary />
          </div>
          <LimitSign limit={formatLimit(limit, u)} big />
        </div>
      </GlassPanel>
      {/* środek: widać mapę z trasą (tło ekranu nav) */}
      <div style={{ flex: 1, minWidth: 0 }} />
      <JobPanel />
    </div>
  );
}

registerWidget({ id: "nav", label: "Nawigacja", size: "1x1", component: NavWidget, opens: "nav" });
registerWidget({ id: "job", label: "Zlecenie", size: "1x1", component: JobWidget, opens: "nav" });
registerScreen({ id: "nav", label: "Nawigacja", icon: "navigation", order: 20, component: NavScreen });
