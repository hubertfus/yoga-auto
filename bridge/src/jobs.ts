/**
 * JobHistory — historia zleceń (M4/S5): zakończone (`job.delivered`) i anulowane (`job.cancelled`).
 *
 * Źródła: `config.job` (opis trasy/ładunku; rośnie z `cfg job`) + `evt` (wynik). Aktywne zlecenie jest
 * rozpoznawane po (ładunek, źródło, cel, dochód), więc kolejne `cfg job` z `cargoLoaded=true` nie tworzą nowego.
 * Zapis: `jobs.jsonl` w katalogu danych bridge'a (jedna linia = jedno zlecenie), serwowane przez `GET /api/jobs`.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { GameEvent, JobConfig } from "@yoga-auto/protocol";

export interface JobRecord {
  id: string;
  status: "delivered" | "cancelled";
  /** `bus` = kurs autobusowy; brak (starsze wpisy) = ładunek */
  kind?: "cargo" | "bus";
  cargo: string;
  /** kg */
  mass: number;
  from: { city: string; company: string } | null;
  to: { city: string; company: string } | null;
  /** zaplanowany dochód ze zlecenia (waluta gry) */
  income: number;
  /** faktyczny przychód (delivered) — 0 przy anulowaniu */
  revenue: number;
  /** kara za anulowanie */
  penalty: number;
  /** km: przejechane (delivered, z gry) albo planowane (cancelled) */
  distanceKm: number;
  plannedDistanceKm: number;
  /** 0..1 */
  cargoDamage: number;
  /** minuty gry zużyte na dostawę (delivered) */
  gameMinutes: number;
  /** czas rzeczywisty (ms epoch): start zlecenia (znany bridge'owi) i koniec */
  startedAt: number;
  endedAt: number;
  /** s rzeczywiste od startu do końca (zaokrąglone) */
  durationS: number;
}

export interface JobTotals {
  count: number;
  delivered: number;
  cancelled: number;
  revenue: number;
  penalties: number;
  distanceKm: number;
  /** s rzeczywiste */
  durationS: number;
}

export interface JobsRes {
  jobs: JobRecord[];
  totals: JobTotals;
}

export interface JobStorage {
  append(rec: JobRecord): void;
  readAll(): JobRecord[];
}

export class MemoryJobStorage implements JobStorage {
  readonly records: JobRecord[] = [];
  append(rec: JobRecord): void {
    this.records.push(rec);
  }
  readAll(): JobRecord[] {
    return [...this.records];
  }
}

export class FileJobStorage implements JobStorage {
  readonly file: string;
  constructor(dir: string) {
    this.file = join(dir, "jobs.jsonl");
  }
  append(rec: JobRecord): void {
    mkdirSync(dirname(this.file), { recursive: true });
    appendFileSync(this.file, JSON.stringify(rec) + "\n", "utf8");
  }
  readAll(): JobRecord[] {
    if (!existsSync(this.file)) return [];
    return readFileSync(this.file, "utf8")
      .split("\n")
      .filter(Boolean)
      .flatMap((l) => {
        try {
          const r = JSON.parse(l) as JobRecord;
          return typeof r === "object" && r && typeof r.id === "string" ? [r] : [];
        } catch {
          return [];
        }
      });
  }
}

/** Tożsamość zlecenia; kurs autobusowy po całej linii (etapy zmieniają źródło/cel, ale to ten sam kurs). */
const sig = (j: JobConfig) => {
  const st = j.bus?.stages;
  if (j.kind === "bus" && st?.length) return `bus|${st[0]!.from.id}|${st.at(-1)!.to.id}|${st.length}|${j.income}`;
  return `${j.cargoId}|${j.source.cityId}.${j.source.companyId}|${j.destination.cityId}.${j.destination.companyId}|${j.income}`;
};
const place = (p: JobConfig["source"]) => ({ city: p.city, company: p.company });

export class JobHistory {
  private active: { job: JobConfig; startedAt: number } | null = null;
  private seq = 0;
  private readonly storage: JobStorage;
  private readonly now: () => number;

  constructor(storage: JobStorage, now: () => number = Date.now) {
    this.storage = storage;
    this.now = now;
  }

  /**
   * `config.job` się zmienił (null = brak zlecenia). Nie kończy zlecenia — to robi `evt`.
   * Zwraca true, gdy to nowe zlecenie (a nie aktualizacja bieżącego, np. kolejny etap kursu).
   */
  onJob(job: JobConfig | null, now: number = this.now()): boolean {
    if (!job) return false; // wynik zleceniu nadaje `evt`; zerowanie configu po evt/bez evt nie tworzy wpisu
    if (this.active && sig(this.active.job) === sig(job)) {
      this.active.job = job;
      return false;
    }
    this.active = { job, startedAt: now };
    return true;
  }

  /** Zdarzenie gry: dla `job.delivered`/`job.cancelled` zapisz wpis i zwróć go. */
  onEvent(ev: GameEvent, now: number = this.now()): JobRecord | null {
    if (ev.kind !== "job.delivered" && ev.kind !== "job.cancelled") return null;
    const a = this.active;
    this.active = null;
    const delivered = ev.kind === "job.delivered";
    const startedAt = a?.startedAt ?? now;
    const rec: JobRecord = {
      id: `${now.toString(36)}-${(this.seq++).toString(36)}`,
      status: delivered ? "delivered" : "cancelled",
      ...((a?.job.kind ?? ev.jobKind) === "bus" ? { kind: "bus" as const } : {}),
      cargo: a?.job.cargo ?? "",
      mass: a?.job.mass ?? 0,
      from: a ? place(a.job.source) : null,
      to: a ? place(a.job.destination) : null,
      income: a?.job.income ?? 0,
      revenue: delivered ? ev.revenue : 0,
      penalty: delivered ? 0 : ev.penalty,
      distanceKm: delivered ? ev.distanceKm : (a?.job.plannedDistanceKm ?? 0),
      plannedDistanceKm: a?.job.plannedDistanceKm ?? 0,
      cargoDamage: delivered ? ev.cargoDamage : 0,
      gameMinutes: delivered ? ev.deliveryTime : 0,
      startedAt,
      endedAt: now,
      durationS: Math.max(0, Math.round((now - startedAt) / 1000)),
    };
    try {
      this.storage.append(rec);
    } catch {
      // zapis best-effort
    }
    return rec;
  }

  /** Najnowsze pierwsze, `limit` ostatnich; sumy z całej historii. */
  list(limit = 200): JobsRes {
    const all = this.storage.readAll();
    return { jobs: all.slice(-limit).reverse(), totals: totalsOf(all) };
  }
}

export function totalsOf(all: readonly JobRecord[]): JobTotals {
  const t: JobTotals = { count: all.length, delivered: 0, cancelled: 0, revenue: 0, penalties: 0, distanceKm: 0, durationS: 0 };
  for (const r of all) {
    if (r.status === "delivered") {
      t.delivered++;
      t.revenue += r.revenue;
      t.distanceKm += r.distanceKm;
    } else {
      t.cancelled++;
      t.penalties += r.penalty;
    }
    t.durationS += r.durationS;
  }
  return t;
}
