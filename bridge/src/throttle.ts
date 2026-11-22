/**
 * Throttling per klient (PROTOCOL.md §3).
 *
 * Każdy klient WS ma własny `ClientStream`:
 * - pamięta, co mu FAKTYCZNIE wysłano (`sentFast`/`sentSlow`), więc klienci z różnym `fastHz`,
 *   z pominiętymi ramkami (backpressure) albo bez subskrypcji `placement` nigdy nie gubią delt;
 * - progi porównują bieżącą wartość z ostatnio WYSŁANĄ (dryf się kumuluje i w końcu przechodzi próg);
 * - `seq` jest licznikiem per połączenie, wspólnym dla fast/slow/config/status (klient wykrywa dziury).
 */
import {
  PLACEMENT_MAX_HZ,
  type Delta,
  type FastState,
  type FullState,
  type SlowState,
} from "@yoga-auto/protocol";

/** Ścieżka → minimalna zmiana liczby, która jest wysyłana. `*` = dowolny indeks tablicy / klucz. */
export type Thresholds = Readonly<Record<string, number>>;

/** Progi kanału `fast` (PROTOCOL.md §3). */
export const FAST_THRESHOLDS: Thresholds = {
  speed: 0.05,
  rpm: 10,
  throttle: 0.01,
  brake: 0.01,
  "placement.x": 0.05,
  "placement.y": 0.05,
  "placement.z": 0.05,
  "placement.heading": 0.0001,
};

/** Progi kanału `slow` (PROTOCOL.md §3 + uzupełnienia bridge'a dla pól ciągłych). */
export const SLOW_THRESHOLDS: Thresholds = {
  "fuel.amount": 0.1,
  "fuel.rangeKm": 1,
  "fuel.avgConsumption": 0.001,
  "adblue.amount": 0.1,
  "air.pressure": 0.5,
  "temps.oil": 0.5,
  "temps.water": 0.5,
  "temps.brake": 0.5,
  "oilPressure.value": 0.5,
  "battery.voltage": 0.05,
  "wear.engine": 0.001,
  "wear.transmission": 0.001,
  "wear.cabin": 0.001,
  "wear.chassis": 0.001,
  "wear.wheels": 0.001,
  "trailers.*.cargoDamage": 0.001,
  "trailers.*.wear.chassis": 0.001,
  "trailers.*.wear.wheels": 0.001,
  "trailers.*.wear.body": 0.001,
  "trip.distance": 10,
  "trip.fuelUsed": 0.05,
  "trip.driveTime": 1,
  "trip.instantConsumption": 0.1,
  "tripB.distance": 10,
  "tripB.fuelUsed": 0.05,
  "tripB.driveTime": 1,
  "tripB.instantConsumption": 0.1,
};

/**
 * Czy `next` różni się od `prev` istotnie.
 * Liczby: |Δ| ≥ próg (albo przejście na dokładne 0 — żeby zegary „siadały” na zerze). Reszta: równość.
 */
export function changed(prev: unknown, next: unknown, path: string, th: Thresholds): boolean {
  if (prev === next) return false;
  if (typeof prev === "number" && typeof next === "number") {
    const limit = th[path];
    if (limit === undefined) return true;
    if (next === 0) return true;
    if (Number.isNaN(prev) !== Number.isNaN(next)) return true;
    // tolerancja na błąd zaokrągleń (184233.3 - 184233.2 = 0.0999999…)
    return Math.abs(next - prev) >= limit * (1 - 1e-6);
  }
  if (typeof prev !== "object" || typeof next !== "object" || prev === null || next === null) return true;
  if (Array.isArray(prev) !== Array.isArray(next)) return true;
  if (Array.isArray(prev)) {
    const n = next as unknown[];
    if (prev.length !== n.length) return true;
    for (let i = 0; i < n.length; i++) if (changed(prev[i], n[i], `${path}.*`, th)) return true;
    return false;
  }
  const p = prev as Record<string, unknown>;
  const q = next as Record<string, unknown>;
  const keys = new Set([...Object.keys(p), ...Object.keys(q)]);
  for (const k of keys) if (changed(p[k], q[k], path ? `${path}.${k}` : k, th)) return true;
  return false;
}

/** Wybierz grupy, które zmieniły się istotnie względem `sent`. Zwraca deltę z klonami (bezpieczne do zapamiętania). */
export function diffGroups<T extends object>(
  sent: T,
  current: T,
  th: Thresholds,
  skip?: (key: keyof T) => boolean,
): Delta<T> | null {
  let d: Delta<T> | null = null;
  for (const k of Object.keys(current) as (keyof T)[]) {
    if (skip?.(k)) continue;
    if (changed(sent[k], current[k], k as string, th)) {
      d ??= {};
      d[k] = structuredClone(current[k]);
    }
  }
  return d;
}

export interface StreamOptions {
  fastHz: number;
  placement?: boolean;
  fastThresholds?: Thresholds;
  slowThresholds?: Thresholds;
}

/** Tolerancja harmonogramu: ramka wolno wyjść o 25% okresu wcześniej (jitter klatek gry vs okres klienta). */
const EARLY_FRACTION = 0.25;

export class ClientStream {
  /** ostatni użyty numer sekwencji (snapshot niesie bieżącą wartość, delta — kolejną) */
  seq = 0;
  fastHz: number;
  placement: boolean;
  private nextFastAt = 0;
  private lastPlacementAt = -Infinity;
  private sentFast: FastState;
  private sentSlow: SlowState;
  private readonly fastTh: Thresholds;
  private readonly slowTh: Thresholds;

  constructor(state: FullState, opts: StreamOptions) {
    this.fastHz = opts.fastHz;
    this.placement = opts.placement ?? false;
    this.fastTh = opts.fastThresholds ?? FAST_THRESHOLDS;
    this.slowTh = opts.slowThresholds ?? SLOW_THRESHOLDS;
    this.sentFast = structuredClone(state.fast);
    this.sentSlow = structuredClone(state.slow);
  }

  /** Klient dostaje pełny stan: od teraz delty liczone względem niego. Zwraca `seq` do snapshotu. */
  synced(state: FullState): number {
    this.sentFast = structuredClone(state.fast);
    this.sentSlow = structuredClone(state.slow);
    return this.seq;
  }

  /** Czy klient jest gotowy na kolejną ramkę `fast`. */
  fastDue(now: number): boolean {
    return now >= this.nextFastAt - EARLY_FRACTION * (1000 / this.fastHz);
  }

  /**
   * Delta `fast` do wysłania teraz albo null (nic istotnego / jeszcze nie pora).
   * Nie przesuwa harmonogramu, gdy nie ma czego wysłać — następna zmiana wyjdzie od razu.
   */
  takeFast(current: FastState, now: number): Delta<FastState> | null {
    if (!this.fastDue(now)) return null;
    const placementOk = this.placement && now - this.lastPlacementAt >= 1000 / PLACEMENT_MAX_HZ;
    const d = diffGroups(this.sentFast, current, this.fastTh, (k) => k === "placement" && !placementOk);
    if (!d) return null;
    Object.assign(this.sentFast, d);
    if ("placement" in d) this.lastPlacementAt = now;
    const period = 1000 / this.fastHz;
    // min. odstęp między ramkami = 0.75 okresu; wysłanie „za wcześnie” przesuwa kolejny termin dalej
    this.nextFastAt = Math.max(this.nextFastAt + period, now + period);
    return d;
  }

  takeSlow(current: SlowState): Delta<SlowState> | null {
    const d = diffGroups(this.sentSlow, current, this.slowTh);
    if (!d) return null;
    Object.assign(this.sentSlow, d);
    return d;
  }

  nextSeq(): number {
    return ++this.seq;
  }
}
