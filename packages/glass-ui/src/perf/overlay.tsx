import { useState, useSyncExternalStore } from "react";
import { tokens } from "@yoga-auto/design-tokens";
import { PERF_TIERS } from "@yoga-auto/design-tokens";
import { perfStore, type PerfMode } from "./store.ts";
import { surfaces } from "./surfaceRegistry.ts";

/**
 * Overlay `?perf=1`: fps, p50/p95/p99, tier, liczba powierzchni ze szkłem, ostatnie zmiany tieru.
 * Celowo BEZ backdrop-filter, żeby nie zaburzać pomiaru. Aktualizuje się raz na okno (2 s).
 */
export function PerfOverlay({ burnMs = 0 }: { burnMs?: number }) {
  const snap = useSyncExternalStore(perfStore.subscribe, perfStore.getSnapshot);
  useSyncExternalStore(surfaces.subscribe, () => surfaces.version);
  const [open, setOpen] = useState(true);
  const s = snap.stats;
  const limit = Number(tokens.tier[snap.tier]["max-surfaces"]);
  const budgetOk = s ? s.p95 <= 16.7 + 0.8 : null;
  const modes: PerfMode[] = ["auto", ...PERF_TIERS];

  return (
    <div className="lg-perf" data-ok={budgetOk ?? undefined} role="status" aria-live="off">
      <button type="button" className="lg-perf__head" onClick={() => setOpen((o) => !o)}>
        <b>{snap.tier}</b>
        <span>{s ? `${s.fps.toFixed(0)} fps` : "…"}</span>
        <span>{s ? `p95 ${s.p95.toFixed(1)} ms` : ""}</span>
        {burnMs ? <span className="lg-perf__burn">BURN {burnMs}ms</span> : null}
      </button>
      {open ? (
        <div className="lg-perf__body">
          <div>
            p50 {s?.p50.toFixed(1) ?? "–"} · p95 {s?.p95.toFixed(1) ?? "–"} · p99 {s?.p99.toFixed(1) ?? "–"} ms
          </div>
          <div>
            max {s?.max?.toFixed(1) ?? "–"} ms · pominięte klatki {s?.dropped ?? "–"} / {s?.samples ?? "–"}
          </div>
          <div>
            szkło: {surfaces.activeCount}/{surfaces.totalCount} powierzchni (limit {limit})
          </div>
          {snap.batteryLimited ? <div>bateria &lt; 20% → max lite</div> : null}
          {snap.lastChange ? (
            <div>
              {snap.lastChange.from}→{snap.lastChange.to} ({snap.lastChange.reason})
            </div>
          ) : null}
          <div className="lg-perf__modes">
            {modes.map((m) => (
              <button key={m} type="button" data-on={snap.mode === m || undefined} onClick={() => perfStore.setMode(m)}>
                {m}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
