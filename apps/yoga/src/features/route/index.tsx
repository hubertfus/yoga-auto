/**
 * Trasa GPS: panel najbliższego manewru i lista kolejnych („za 300 m skręć w prawo”, „prosto przez 200 km”, …).
 * Trasę liczy bridge (bridge/src/route); tu tylko postęp i prezentacja. Używane przez ekran `nav`, mapę i widget Home.
 */
import { useState, type ReactNode } from "react";
import { GlassButton, Icon } from "@yoga-auto/glass-ui";
import { useConfig, useConnectionSelect } from "../../core/store.ts";
import { DestinationSheet } from "./destination.tsx";
import { useUnits } from "../units/index.ts";
import { ManeuverIcon } from "./ManeuverIcon.tsx";
import { MANEUVER_TEXT, OFF_ROUTE_UI_M, formatManeuverDistance, useRouteProgress, type RouteProgress } from "./model.ts";
import "./route.css";

export { ManeuverIcon } from "./ManeuverIcon.tsx";
export * from "./model.ts";
export { DestinationSheet, RouteTargetBar, labelForPoint, loadPlaces, sendRouteTarget, usePlaces } from "./destination.tsx";

/** Powód braku trasy (do komunikatu). null = trasa jest. */
function useNoRouteReason(progress: RouteProgress | null): string | null {
  const supported = useConnectionSelect((c) => c.hello?.capabilities.route ?? false);
  const job = useConfig((c) => c.job);
  if (progress) return null;
  if (!supported) return "Trasa niedostępna: brak grafu dróg na PC (npm run map:graph)";
  if (!job) return "Brak zlecenia i celu. Wyszukaj cel albo przytrzymaj palec na mapie.";
  return "Wyznaczam trasę…";
}

/** Duży panel: strzałka + „300 m” + „Skręć w prawo”, pod spodem „Następnie …”. */
export function NextManeuver({ compact = false }: { compact?: boolean }) {
  const progress = useRouteProgress(3);
  const imperial = useUnits().speed === "mph";
  const reason = useNoRouteReason(progress);
  const supported = useConnectionSelect((c) => c.hello?.capabilities.route ?? false);
  const [searchOpen, setSearchOpen] = useState(false);
  if (!progress)
    return (
      <div className="rt-empty" data-testid="route-empty" data-compact={compact || undefined}>
        <span>{reason}</span>
        {supported && !compact ? (
          <GlassButton size="md" icon={<Icon name="search" />} label="Wybierz cel" onPress={() => setSearchOpen(true)} />
        ) : null}
        <DestinationSheet open={searchOpen} onClose={() => setSearchOpen(false)} />
      </div>
    );
  const [cur, next] = progress.upcoming;
  if (!cur) return <div className="rt-empty">Na miejscu</div>;
  const off = progress.offset > OFF_ROUTE_UI_M;
  return (
    <div className="rt-next" data-compact={compact || undefined} data-off={off || undefined} data-testid="route-next">
      <div className="rt-next__main">
        <span className="rt-next__icon">
          <ManeuverIcon kind={cur.maneuver.kind} angle={cur.maneuver.angle} size={compact ? 48 : 76} />
        </span>
        <div className="rt-next__txt">
          <div className="rt-next__dist" data-testid="route-next-dist">
            {formatManeuverDistance(cur.distance, imperial)}
          </div>
          <div className="rt-next__label">{off ? "Poza trasą, przeliczam…" : MANEUVER_TEXT[cur.maneuver.kind]}</div>
        </div>
      </div>
      {next && !compact ? (
        <div className="rt-then">
          <span className="rt-then__k">Następnie</span>
          {next.leg >= 1500 ? <span>prosto {formatManeuverDistance(next.leg, imperial)}, potem</span> : null}
          <ManeuverIcon kind={next.maneuver.kind} angle={next.maneuver.angle} size={26} />
          <span>{MANEUVER_TEXT[next.maneuver.kind].toLowerCase()}</span>
        </div>
      ) : null}
    </div>
  );
}

/** Lista kolejnych manewrów z odcinkami „prosto przez …” między nimi. */
export function ManeuverList({ count = 6, skipFirst = true }: { count?: number; skipFirst?: boolean }) {
  const progress = useRouteProgress(count + 1);
  const imperial = useUnits().speed === "mph";
  if (!progress) return null;
  const items = progress.upcoming.slice(skipFirst ? 1 : 0);
  if (!items.length) return null;
  const rows: { key: string; icon: ReactNode; text: string; dist: string; dim?: boolean }[] = [];
  for (const [i, u] of items.entries()) {
    if (u.leg >= 1500)
      rows.push({
        key: `s${i}`,
        icon: <ManeuverIcon kind="straight" size={26} />,
        text: `Prosto przez ${formatManeuverDistance(u.leg, imperial)}`,
        dist: "",
        dim: true,
      });
    rows.push({
      key: `m${i}`,
      icon: <ManeuverIcon kind={u.maneuver.kind} angle={u.maneuver.angle} size={30} />,
      text: MANEUVER_TEXT[u.maneuver.kind],
      dist: formatManeuverDistance(u.distance, imperial),
    });
  }
  return (
    <ol className="rt-list" data-testid="route-list">
      {rows.map((r) => (
        <li key={r.key} data-dim={r.dim || undefined}>
          <span className="rt-list__icon">{r.icon}</span>
          <span className="rt-list__text">{r.text}</span>
          <span className="rt-list__dist">{r.dist}</span>
        </li>
      ))}
    </ol>
  );
}

/** Pozostały dystans wg naszej trasy (gdy gra nie podaje własnego). */
export function RouteRemaining() {
  const progress = useRouteProgress(1);
  const imperial = useUnits().speed === "mph";
  if (!progress) return null;
  return <span className="ft-dim">{formatManeuverDistance(progress.remaining, imperial)} do celu</span>;
}
