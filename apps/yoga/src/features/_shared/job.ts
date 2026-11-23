/** Teksty zleceń: ładunek (ciężarówka) albo kurs autobusowy (`job.kind === "bus"`, SDK `bus_job`). */
import type { JobConfig } from "@yoga-auto/protocol";

export const isBusJob = (job: Pick<JobConfig, "kind"> | null | undefined): boolean => job?.kind === "bus";

/** Polska odmiana po liczebniku: 1 / 2–4 (bez 12–14) / reszta. */
export function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(Math.trunc(n));
  if (a === 1) return one;
  const d = a % 10;
  const t = a % 100;
  return d >= 2 && d <= 4 && (t < 12 || t > 14) ? few : many;
}

/** „32/49 pasażerów”, „1 pasażer”, „49 miejsc”; null gdy gra nie podała. */
export function passengersText(job: JobConfig): string | null {
  const p = job.bus?.passengers ?? null;
  const c = job.bus?.capacity ?? null;
  if (p === null) return c === null ? null : `${c} ${plural(c, "miejsce", "miejsca", "miejsc")}`;
  const word = plural(p, "pasażer", "pasażerów", "pasażerów");
  return c !== null ? `${p}/${c} ${word}` : `${p} ${word}`;
}

export function stopsText(job: JobConfig): string | null {
  const s = job.bus?.stops ?? null;
  return s === null ? null : `${s} ${plural(s, "przystanek", "przystanki", "przystanków")}`;
}

/** Krótki opis kursu autobusowego: „Kurs autobusowy · 32/49 pasażerów · 5 przystanków”. */
export function busSummary(job: JobConfig): string {
  return ["Kurs autobusowy", passengersText(job), stopsText(job)].filter(Boolean).join(" · ");
}
