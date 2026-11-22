/** Historia zleceń (M4): lista zakończonych i anulowanych zleceń z bridge'a (`GET /api/jobs`) + sumy. */
import { useCallback, useEffect, useState } from "react";
import { GlassButton, GlassPanel, Icon } from "@yoga-auto/glass-ui";
import { getToken } from "../../core/client.ts";
import { registerScreen } from "../../core/registry.ts";
import { useGameEvents } from "../../core/store.ts";
import { CardTitle, Stat } from "../_shared/shared.tsx";
import { formatDuration, formatKm, formatMass, formatMinutes, formatMoney, formatPercent, useUnits } from "../units/index.ts";

/** Kształt odpowiedzi `GET /api/jobs` (bridge/src/jobs.ts). */
export interface JobRecord {
  id: string;
  status: "delivered" | "cancelled";
  cargo: string;
  mass: number;
  from: { city: string; company: string } | null;
  to: { city: string; company: string } | null;
  income: number;
  revenue: number;
  penalty: number;
  distanceKm: number;
  plannedDistanceKm: number;
  cargoDamage: number;
  gameMinutes: number;
  startedAt: number;
  endedAt: number;
  durationS: number;
}

export interface JobTotals {
  count: number;
  delivered: number;
  cancelled: number;
  revenue: number;
  penalties: number;
  distanceKm: number;
  durationS: number;
}

export interface JobsRes {
  jobs: JobRecord[];
  totals: JobTotals;
}

export async function fetchJobs(limit = 100, base = ""): Promise<JobsRes | null> {
  try {
    const token = getToken();
    const res = await fetch(`${base}/api/jobs?limit=${limit}`, {
      cache: "no-store",
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) return null;
    const body = (await res.json()) as Partial<JobsRes>;
    if (!body || !Array.isArray(body.jobs) || !body.totals) return null;
    return body as JobsRes;
  } catch {
    return null;
  }
}

/** Trasa „Wrocław → Hamburg”; brak danych (bridge wystartował w trakcie zlecenia) → „–”. */
export function routeLabel(j: Pick<JobRecord, "from" | "to">): string {
  if (!j.from && !j.to) return "–";
  return `${j.from?.city ?? "?"} → ${j.to?.city ?? "?"}`;
}

/** Dochód wpisu: dostarczone → przychód, anulowane → kara (ujemna). */
export const jobResult = (j: Pick<JobRecord, "status" | "revenue" | "penalty">): number =>
  j.status === "delivered" ? j.revenue : -j.penalty;

const dateFmt = new Intl.DateTimeFormat("pl-PL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export function JobsTotals({ totals }: { totals: JobTotals }) {
  const u = useUnits();
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "var(--s-5)" }} data-testid="jobs-totals">
      <Stat label="Zlecenia" value={`${totals.delivered}`} unit={totals.cancelled ? `+ ${totals.cancelled} anul.` : undefined} />
      <Stat label="Przychód" value={formatMoney(totals.revenue)} />
      <Stat label="Kary" value={formatMoney(-totals.penalties)} tone={totals.penalties > 0 ? "warn" : undefined} />
      <Stat label="Dystans / czas" value={formatKm(totals.distanceKm, u)} unit={formatDuration(totals.durationS)} />
    </div>
  );
}

function JobRow({ job }: { job: JobRecord }) {
  const u = useUnits();
  const ok = job.status === "delivered";
  return (
    <div className="ft-job-row" data-status={job.status} data-testid="job-row">
      <div className="ft-grow">
        <div className="ft-mid">{routeLabel(job)}</div>
        <div className="ft-dim">
          {job.cargo || "–"}
          {job.mass ? ` · ${formatMass(job.mass)}` : ""}
          {ok && job.cargoDamage > 0 ? ` · uszk. ${formatPercent(job.cargoDamage, true)}` : ""}
        </div>
      </div>
      <div className="ft-job-row__cell">
        <span className="ft-stat__label">{ok ? "Dochód" : "Anulowane"}</span>
        <span className="ft-mid" data-tone={ok ? "ok" : "crit"}>
          {formatMoney(jobResult(job))}
        </span>
      </div>
      <div className="ft-job-row__cell">
        <span className="ft-stat__label">Dystans</span>
        <span className="ft-mid">{formatKm(job.distanceKm, u)}</span>
      </div>
      <div className="ft-job-row__cell">
        <span className="ft-stat__label">Czas</span>
        <span className="ft-mid">{ok && job.gameMinutes ? formatMinutes(job.gameMinutes) : formatDuration(job.durationS)}</span>
        <span className="ft-dimmer">{dateFmt.format(job.endedAt)}</span>
      </div>
    </div>
  );
}

export function JobsList({ data }: { data: JobsRes }) {
  if (!data.jobs.length)
    return (
      <div className="ft-dim" data-testid="jobs-empty">
        Brak zakończonych zleceń. Pojawią się tu po dostawie lub anulowaniu.
      </div>
    );
  return (
    <div className="ft-job-list">
      {data.jobs.map((j) => (
        <JobRow key={j.id} job={j} />
      ))}
    </div>
  );
}

function JobsScreen() {
  const [data, setData] = useState<JobsRes | null>(null);
  const [loaded, setLoaded] = useState(false);
  const load = useCallback(async () => {
    const r = await fetchJobs();
    if (r) setData(r);
    setLoaded(true);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  // po dostawie/anulowaniu bridge zapisuje wpis chwilę po evt
  useGameEvents((e) => {
    if (e.kind === "job.delivered" || e.kind === "job.cancelled") setTimeout(() => void load(), 400);
  });
  return (
    <div className="ft-screen" data-testid="jobs-screen">
      <GlassPanel padding={24} tint="strong">
        <div className="ft-spread">
          <CardTitle icon={<Icon name="euro" size={20} />}>Historia zleceń</CardTitle>
          <GlassButton size="md" icon={<Icon name="refresh" />} label="Odśwież" onPress={() => void load()} />
        </div>
        <div style={{ height: "var(--s-4)" }} />
        {data ? (
          <JobsTotals totals={data.totals} />
        ) : (
          <div className="ft-dim" data-testid="jobs-unavailable">
            {loaded ? "Historia niedostępna (bridge nie odpowiada lub jest starszy)." : "Ładowanie…"}
          </div>
        )}
      </GlassPanel>
      {data ? (
        <GlassPanel padding={24}>
          <JobsList data={data} />
        </GlassPanel>
      ) : null}
    </div>
  );
}

registerScreen({ id: "jobs", label: "Zlecenia", icon: "cargo", order: 55, component: JobsScreen });
