/**
 * Kurs autobusowy na tablecie: lista przystanków (plan/faktyczne godziny, wsiadający/wysiadający, stan)
 * i pozycje przystanków na mapie. Przystanki z gry to miasta (token), pozycje z `route-places.json`.
 */
import { useEffect, useMemo, useState } from "react";
import type { BusStage, BusStop, JobConfig } from "@yoga-auto/protocol";
import { formatGameTime } from "../units/index.ts";
import { loadPlaces } from "./destination.tsx";

export type StopState = "done" | "here" | "next" | "later";

export interface StopRow {
  index: number;
  stop: BusStop;
  /** przyjazd (dla pierwszego: odjazd), minuty gry */
  planned: number | null;
  actual: number | null;
  /** wysiadający (przyjazd) / wsiadający (odjazd); null = gra nie podała */
  alighting: number | null;
  boarding: number | null;
  /** odjazd z tego przystanku (plan) — dla przystanków pośrednich */
  departPlanned: number | null;
  state: StopState;
}

/**
 * Przystanki kursu w kolejności: start etapu 0, potem cel każdego etapu. Stan względem bieżącego etapu
 * `current` (gra liczy etapy od 0; cel trasy = cel etapu `current`):
 *   przed `current` — miniony; `current` — tu jesteśmy (przed odjazdem) albo miniony (po odjeździe);
 *   `current + 1` — następny; dalej — później.
 */
export function stopRows(stages: readonly BusStage[], current: number): StopRow[] {
  if (!stages.length) return [];
  const rows: StopRow[] = [];
  for (let k = 0; k <= stages.length; k++) {
    const arrive = k > 0 ? stages[k - 1]! : null;
    const depart = k < stages.length ? stages[k]! : null;
    const departed = depart?.departActual != null;
    const state: StopState =
      k < current ? "done" : k === current ? (departed ? "done" : "here") : k === current + 1 ? "next" : "later";
    rows.push({
      index: k,
      stop: arrive ? arrive.to : depart!.from,
      planned: arrive ? arrive.arrivePlanned : depart!.departPlanned,
      actual: arrive ? arrive.arriveActual : depart!.departActual,
      alighting: arrive ? (arrive.alightingActual ?? arrive.alightingPlanned) : null,
      boarding: depart ? (depart.boardingActual ?? depart.boardingPlanned) : null,
      departPlanned: arrive && depart ? depart.departPlanned : null,
      state,
    });
  }
  return rows;
}

/** Opóźnienie w minutach gry (dodatnie = spóźnienie), null gdy brak faktycznej godziny. */
export const delayMin = (r: Pick<StopRow, "planned" | "actual">): number | null =>
  r.planned !== null && r.actual !== null ? Math.round(r.actual - r.planned) : null;

/** Lista przystanków kursu (panel kursu na ekranie nawigacji). */
export function BusStops({ job, max }: { job: JobConfig; max?: number }) {
  const bus = job.bus;
  if (!bus?.stages.length) return null;
  let rows = stopRows(bus.stages, bus.current);
  if (max && rows.length > max) {
    // okno wokół bieżącego miejsca: ostatni miniony + następne
    const from = Math.max(0, Math.min(rows.length - max, bus.current));
    rows = rows.slice(from, from + max);
  }
  return (
    <ol className="bus-stops" data-testid="bus-stops">
      {rows.map((r) => {
        const late = delayMin(r);
        return (
          <li key={r.index} className="bus-stop" data-state={r.state} data-testid="bus-stop">
            <span className="bus-stop__dot" aria-hidden="true" />
            <div className="bus-stop__main">
              <div className="bus-stop__name">{r.stop.name}</div>
              <div className="bus-stop__sub">
                {r.alighting !== null ? <span title="wysiada">↓{r.alighting}</span> : null}
                {r.boarding !== null ? <span title="wsiada">↑{r.boarding}</span> : null}
                {r.state === "here" ? <span className="bus-stop__tag">tu jesteś</span> : null}
                {r.state === "next" ? <span className="bus-stop__tag">następny</span> : null}
              </div>
            </div>
            <div className="bus-stop__time">
              <span>{formatGameTime(r.actual ?? r.planned)}</span>
              {late !== null && late !== 0 ? (
                <span className="bus-stop__late" data-tone={late > 0 ? "crit" : "ok"}>
                  {late > 0 ? `+${late}` : late} min
                </span>
              ) : r.departPlanned !== null && r.state !== "done" ? (
                <span className="bus-stop__dep">odj. {formatGameTime(r.departPlanned)}</span>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Następny przystanek (cel bieżącego etapu) i numer etapu, np. „Budapeszt”, „1/7”. */
export function nextStop(job: JobConfig | null): { name: string; stage: string } | null {
  const bus = job?.bus;
  if (!bus?.stages.length) return null;
  const st = bus.stages[bus.current];
  return st ? { name: st.to.name, stage: `${bus.current + 1}/${bus.stages.length}` } : null;
}

export interface StopPoint {
  x: number;
  z: number;
  name: string;
  state: StopState;
}

/** Pozycje przystanków (środki miast po tokenie); przystanki bez pozycji pomijane. */
export function useStopPoints(job: JobConfig | null): StopPoint[] {
  const [cities, setCities] = useState<Map<string, { x: number; z: number }> | null>(null);
  const hasStages = Boolean(job?.bus?.stages.length);
  useEffect(() => {
    if (!hasStages || cities) return;
    let alive = true;
    void loadPlaces().then((places) => {
      if (!alive) return;
      const m = new Map<string, { x: number; z: number }>();
      for (const p of places) if (p.kind === "city" && p.token) m.set(p.token, { x: p.x, z: p.z });
      setCities(m);
    });
    return () => {
      alive = false;
    };
  }, [hasStages, cities]);
  const bus = job?.bus;
  return useMemo(() => {
    if (!bus?.stages.length || !cities) return [];
    return stopRows(bus.stages, bus.current).flatMap((r) => {
      const c = cities.get(r.stop.id);
      return c ? [{ x: c.x, z: c.z, name: r.stop.name, state: r.state }] : [];
    });
  }, [bus, cities]);
}
