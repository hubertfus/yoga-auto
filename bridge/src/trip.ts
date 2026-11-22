/**
 * TripComputer — komputer pokładowy (ANALYSIS §5.4): dystans, zużyte paliwo, czas jazdy, chwilowe spalanie.
 *
 * - dystans: przyrost `truck.odometer` (autorytet gry; skoki > 2 km na jedną aktualizację = zapis/teleport → nowa baza);
 *   odometr to float32 (~15 m rozdzielczości przy 180 000 km), więc suma jest dokładna, ale do SPALANIA CHWILOWEGO
 *   (okno 10 s) używamy dystansu z całkowania prędkości;
 * - paliwo: suma spadków `truck.fuel.amount` (tankowanie = wzrost, ignorowane → korekta na tankowanie);
 * - czas jazdy: sekundy z prędkością > 0.5 m/s, bez pauzy;
 * - bieżąca wycieczka jest zapisywana w `trip-current.json` (przeżywa restart bridge'a), a przy resecie
 *   (`trip.reset`) zakończona wycieczka dopisuje się do `trips.jsonl`.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { emptyTrip, type FullState, type TripState } from "@yoga-auto/protocol";

export interface FinishedTrip {
  kind: "trip";
  startedAt: number;
  endedAt: number;
  /** m */
  distance: number;
  /** l */
  fuelUsed: number;
  /** s */
  driveTime: number;
  /** m/s, null gdy nie jechano */
  avgSpeed: number | null;
  /** l/100 km, null gdy dystans < 100 m */
  avgConsumption: number | null;
}

export interface TripStorage {
  loadCurrent(): TripState | null;
  saveCurrent(trip: TripState): void;
  appendFinished(trip: FinishedTrip): void;
}

export class MemoryTripStorage implements TripStorage {
  current: TripState | null = null;
  readonly finished: FinishedTrip[] = [];
  loadCurrent(): TripState | null {
    return this.current ? { ...this.current } : null;
  }
  saveCurrent(trip: TripState): void {
    this.current = { ...trip };
  }
  appendFinished(trip: FinishedTrip): void {
    this.finished.push(trip);
  }
}

export class FileTripStorage implements TripStorage {
  readonly currentFile: string;
  readonly historyFile: string;

  /** `suffix` "b" → trip-current-b.json / trips-b.jsonl (drugi licznik, M4). */
  constructor(dir: string, suffix = "") {
    const sfx = suffix ? `-${suffix}` : "";
    this.currentFile = join(dir, `trip-current${sfx}.json`);
    this.historyFile = join(dir, `trips${sfx}.jsonl`);
  }

  loadCurrent(): TripState | null {
    try {
      const t = JSON.parse(readFileSync(this.currentFile, "utf8")) as Partial<TripState>;
      const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
      return {
        distance: n(t.distance),
        fuelUsed: n(t.fuelUsed),
        driveTime: n(t.driveTime),
        instantConsumption: null,
        resetAt: n(t.resetAt),
      };
    } catch {
      return null;
    }
  }

  saveCurrent(trip: TripState): void {
    mkdirSync(dirname(this.currentFile), { recursive: true });
    const tmp = `${this.currentFile}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(trip), "utf8");
    renameSync(tmp, this.currentFile);
  }

  appendFinished(trip: FinishedTrip): void {
    mkdirSync(dirname(this.historyFile), { recursive: true });
    appendFileSync(this.historyFile, JSON.stringify(trip) + "\n", "utf8");
  }

  /** Ostatnie `n` zakończonych wycieczek (do CLI/diagnostyki). */
  readHistory(n = 20): FinishedTrip[] {
    if (!existsSync(this.historyFile)) return [];
    return readFileSync(this.historyFile, "utf8")
      .split("\n")
      .filter(Boolean)
      .slice(-n)
      .flatMap((l) => {
        try {
          return [JSON.parse(l) as FinishedTrip];
        } catch {
          return [];
        }
      });
  }
}

const MOVING_MS = 0.5;
/** Maks. przyrost odometru na jedną aktualizację (km) — więcej to skok (wczytanie zapisu, zmiana ciężarówki). */
const MAX_ODO_STEP_KM = 2;
const WINDOW_S = 10;
const MIN_WINDOW_DIST_M = 50;
const SAVE_EVERY_MS = 10_000;
/** Maks. dt całkowania (s): po długiej przerwie nie doliczamy „zaległego” czasu. */
const MAX_DT_S = 1;

interface Sample {
  t: number;
  dist: number;
  fuel: number;
}

export class TripComputer {
  private trip: TripState;
  private lastOdo: number | null = null;
  private lastFuel: number | null = null;
  private lastT: number | null = null;
  private window: Sample[] = [];
  private lastSavedAt = 0;
  private dirty = false;
  private readonly storage: TripStorage;
  private readonly now: () => number;

  constructor(storage: TripStorage, now: () => number = Date.now) {
    this.storage = storage;
    this.now = now;
    this.trip = storage.loadCurrent() ?? emptyTrip(now());
    if (!this.trip.resetAt) this.trip.resetAt = now();
  }

  get state(): TripState {
    return this.trip;
  }

  /** Wołane cyklicznie (kilka razy na sekundę). Zwraca bieżący `TripState` (nowy obiekt przy każdej zmianie). */
  update(s: FullState, now: number = this.now()): TripState {
    if (!s.status.connected) {
      this.baseline();
      return this.trip;
    }
    const odo = s.slow.odometer;
    const fuel = s.slow.fuel.amount;
    const dt = this.lastT === null ? 0 : Math.min(MAX_DT_S, Math.max(0, (now - this.lastT) / 1000));
    this.lastT = now;
    if (s.status.paused) {
      // pauza: czas stoi, ale nie gubimy bazy
      this.lastOdo = odo;
      this.lastFuel = fuel;
      return this.trip;
    }

    let dDist = 0;
    let dFuel = 0;
    if (this.lastOdo !== null && odo > 0) {
      const step = odo - this.lastOdo;
      if (step > 0 && step <= MAX_ODO_STEP_KM) dDist = step * 1000;
    }
    if (this.lastFuel !== null && fuel < this.lastFuel) dFuel = this.lastFuel - fuel;
    this.lastOdo = odo > 0 ? odo : this.lastOdo;
    this.lastFuel = fuel;

    const moving = Math.abs(s.fast.speed) > MOVING_MS;
    const next: TripState = {
      distance: this.trip.distance + dDist,
      fuelUsed: this.trip.fuelUsed + dFuel,
      driveTime: this.trip.driveTime + (moving ? dt : 0),
      instantConsumption: this.trip.instantConsumption,
      resetAt: this.trip.resetAt,
    };

    // okno spalania chwilowego: dystans z całkowania prędkości (gładszy niż odometr float32)
    this.window.push({ t: now, dist: Math.abs(s.fast.speed) * dt, fuel: dFuel });
    while (this.window.length && now - this.window[0]!.t > WINDOW_S * 1000) this.window.shift();
    const wDist = this.window.reduce((a, x) => a + x.dist, 0);
    const wFuel = this.window.reduce((a, x) => a + x.fuel, 0);
    next.instantConsumption = wDist >= MIN_WINDOW_DIST_M ? round((wFuel / wDist) * 100_000, 1) : null;

    if (
      next.distance !== this.trip.distance ||
      next.fuelUsed !== this.trip.fuelUsed ||
      next.driveTime !== this.trip.driveTime ||
      next.instantConsumption !== this.trip.instantConsumption
    ) {
      this.trip = next;
      this.dirty = true;
    }
    if (this.dirty && now - this.lastSavedAt >= SAVE_EVERY_MS) this.save(now);
    return this.trip;
  }

  /** `trip.reset`: zakończ bieżącą wycieczkę (do `trips.jsonl`, jeśli coś przejechano) i zacznij nową. */
  reset(now: number = this.now()): FinishedTrip | null {
    const t = this.trip;
    let finished: FinishedTrip | null = null;
    if (t.distance > 0 || t.driveTime > 0) {
      finished = {
        kind: "trip",
        startedAt: t.resetAt,
        endedAt: now,
        distance: round(t.distance, 0),
        fuelUsed: round(t.fuelUsed, 2),
        driveTime: round(t.driveTime, 0),
        avgSpeed: t.driveTime > 0 ? round(t.distance / t.driveTime, 2) : null,
        avgConsumption: t.distance >= 100 ? round((t.fuelUsed / t.distance) * 100_000, 1) : null,
      };
      this.storage.appendFinished(finished);
    }
    this.trip = emptyTrip(now);
    this.window = [];
    this.save(now);
    return finished;
  }

  /** Zapisz bieżący stan (przy zamykaniu). */
  flush(): void {
    if (this.dirty) this.save(this.now());
  }

  private baseline(): void {
    this.lastOdo = this.lastFuel = this.lastT = null;
    this.window = [];
  }

  private save(now: number): void {
    try {
      this.storage.saveCurrent(this.trip);
      this.lastSavedAt = now;
      this.dirty = false;
    } catch {
      // zapis best-effort: brak miejsca/uprawnień nie może ubić bridge'a
    }
  }
}

function round(v: number, digits: number): number {
  const p = 10 ** digits;
  return Math.round(v * p) / p;
}
