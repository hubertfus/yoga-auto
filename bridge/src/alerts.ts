/**
 * AlertEngine — reguły z docs/ANALYSIS.md §5.3 liczone w bridge'u (żeby działały też przy kilku klientach).
 *
 * Każda reguła zwraca „stan pożądany” (poziom + dane) albo null; `settle()` dodaje debounce (`onFor` — warunek musi
 * trwać, żeby alert wszedł; `offFor` — musi ustąpić, żeby zniknął) i wykrywa zmianę poziomu/danych. Histereza progów
 * jest w regułach (inny próg wejścia i wyjścia, zależny od tego, czy alert już wisi).
 *
 * `sticky: true`  = alert trwały (wisi, dopóki warunek trwa). `sticky: false` = jednorazowy (toast): bridge sam go
 * wycofuje po ONE_SHOT_TTL_MS, żeby późno połączony klient nie dostał starego toastu w snapshocie.
 *
 * Założenia do weryfikacji w grze (sesja integracyjna): flagi `oil.pressure.warning` i `battery.voltage.warning`
 * mogą się zapalać przy wyłączonym silniku — wtedy ich alerty są pomijane (engineOn=false).
 */
import type { Alert, AlertCode, AlertLevel, FullState } from "@yoga-auto/protocol";

const KMH = 1 / 3.6;

export interface AlertDelta {
  raised: Alert[];
  cleared: string[];
}

export interface AlertThresholds {
  fuelRangeRaiseKm: number;
  fuelRangeClearKm: number;
  speedingOverMs: number;
  speedingClearOverMs: number;
  speedingForMs: number;
  damageHitDelta: number;
  damageHitWindowMs: number;
  damageHitCooldownMs: number;
  damageHighRaise: number;
  damageHighClear: number;
  restSoonMin: number;
  restNowMin: number;
  restMarginMin: number;
  lateRaiseMin: number;
  lateClearMin: number;
  /** po (re)połączeniu źródła reguły są wstrzymane, aż telemetria się ustabilizuje */
  warmupMs: number;
  disconnectedAfterMs: number;
  oneShotTtlMs: number;
}

export const DEFAULT_THRESHOLDS: AlertThresholds = {
  fuelRangeRaiseKm: 100,
  fuelRangeClearKm: 130,
  speedingOverMs: 5 * KMH,
  speedingClearOverMs: 2 * KMH,
  speedingForMs: 3000,
  damageHitDelta: 0.02,
  damageHitWindowMs: 5000,
  damageHitCooldownMs: 3000,
  damageHighRaise: 0.5,
  damageHighClear: 0.45,
  restSoonMin: 60,
  restNowMin: 15,
  restMarginMin: 5,
  lateRaiseMin: 5,
  lateClearMin: 2,
  warmupMs: 1500,
  disconnectedAfterMs: 2000,
  oneShotTtlMs: 8000,
};

interface Desired {
  level: AlertLevel;
  data?: Record<string, number | string | boolean>;
  /** zmiana tego tekstu (przy tym samym poziomie) = wyślij zaktualizowany alert */
  rev?: string;
}

interface SettleOpts {
  onFor?: number;
  offFor?: number;
  sticky?: boolean;
  /** min. odstęp między aktualizacjami samych danych (zmiana poziomu zawsze przechodzi) */
  minUpdateMs?: number;
}

interface Track {
  onSince: number | null;
  offSince: number | null;
  rev: string;
  sentAt: number;
}

const TRUCK_PARTS = ["engine", "transmission", "cabin", "chassis", "wheels"] as const;

export class AlertEngine {
  private readonly th: AlertThresholds;
  private readonly active = new Map<string, Alert>();
  private readonly tracks = new Map<string, Track>();
  private readonly expiries = new Map<string, number>();
  private connectedSince: number | null = null;
  private disconnectedSince: number | null = null;
  private lastHitAt = -Infinity;
  private readonly wearHistory = new Map<string, { t: number; v: number }[]>();
  private truckId: string | null = null;
  private wasPaused = false;

  constructor(thresholds: Partial<AlertThresholds> = {}) {
    this.th = { ...DEFAULT_THRESHOLDS, ...thresholds };
  }

  get alerts(): Alert[] {
    return [...this.active.values()];
  }

  /** Przelicz reguły. Zwraca zmianę zbioru alertów albo null, gdy nic się nie zmieniło. */
  update(s: FullState, now: number): AlertDelta | null {
    const d: AlertDelta = { raised: [], cleared: [] };

    // jednorazowe: wygaszanie po TTL
    for (const [id, at] of this.expiries)
      if (now >= at) {
        this.expiries.delete(id);
        if (this.active.delete(id)) d.cleared.push(id);
      }

    if (!s.status.connected) {
      this.connectedSince = null;
      this.disconnectedSince ??= now;
      this.wearHistory.clear();
      for (const id of [...this.active.keys()])
        if (id !== "game.disconnected") {
          this.active.delete(id);
          this.expiries.delete(id);
          this.tracks.delete(id);
          d.cleared.push(id);
        }
      this.settle(
        d,
        now,
        "game.disconnected",
        now - this.disconnectedSince >= this.th.disconnectedAfterMs
          ? { level: "warning", data: { source: s.status.source } }
          : null,
        { sticky: true },
      );
      return finish(d);
    }

    this.disconnectedSince = null;
    this.settle(d, now, "game.disconnected", null, { sticky: true });
    this.connectedSince ??= now;
    if (now - this.connectedSince < this.th.warmupMs) return finish(d);

    this.ruleFuel(d, now, s);
    this.settle(d, now, "adblue.low", s.slow.adblue.warning ? { level: "warning", data: { amount: s.slow.adblue.amount } } : null, flagOpts);
    this.ruleAir(d, now, s);
    const engineOn = s.fast.engineOn;
    this.settle(d, now, "oil.pressure", engineOn && s.slow.oilPressure.warning ? { level: "warning", data: { value: s.slow.oilPressure.value } } : null, flagOpts);
    this.settle(d, now, "water.temp", s.slow.waterTempWarning ? { level: "warning", data: { temp: s.slow.temps.water } } : null, flagOpts);
    this.settle(d, now, "battery.voltage", engineOn && s.slow.battery.warning ? { level: "warning", data: { voltage: s.slow.battery.voltage } } : null, flagOpts);
    this.ruleRest(d, now, s);
    this.ruleSpeeding(d, now, s);
    this.ruleDamage(d, now, s);
    this.ruleJob(d, now, s);
    return finish(d);
  }

  reset(): AlertDelta | null {
    const cleared = [...this.active.keys()];
    this.active.clear();
    this.tracks.clear();
    this.expiries.clear();
    this.wearHistory.clear();
    this.connectedSince = this.disconnectedSince = null;
    return cleared.length ? { raised: [], cleared } : null;
  }

  // ───────────────────────────── reguły ─────────────────────────────

  private ruleFuel(d: AlertDelta, now: number, s: FullState): void {
    const { amount, rangeKm, warning } = s.slow.fuel;
    const on = this.active.has("fuel.low");
    const lowRange = rangeKm > 0 && rangeKm < (on ? this.th.fuelRangeClearKm : this.th.fuelRangeRaiseKm);
    this.settle(
      d,
      now,
      "fuel.low",
      warning || lowRange
        ? { level: "warning", data: { amount, rangeKm }, rev: String(Math.round(rangeKm / 10)) }
        : null,
      { sticky: true, onFor: 500, offFor: 1500, minUpdateMs: 5000 },
    );
  }

  private ruleAir(d: AlertDelta, now: number, s: FullState): void {
    const { warning, emergency, pressure } = s.slow.air;
    this.settle(d, now, "air.emergency", emergency ? { level: "critical", data: { pressure } } : null, { sticky: true, onFor: 300, offFor: 1000 });
    this.settle(d, now, "air.low", warning && !emergency ? { level: "warning", data: { pressure } } : null, emergency ? { ...flagOpts, offFor: 0 } : flagOpts);
  }

  /** rest.soon / rest.now / rest.overdue — zawsze co najwyżej jeden naraz, z histerezą na zejściu. */
  private ruleRest(d: AlertDelta, now: number, s: FullState): void {
    const m = s.slow.time.restStopMin;
    const codes = ["rest.soon", "rest.now", "rest.overdue"] as const;
    const levels: AlertLevel[] = ["info", "warning", "critical"];
    const curTier = codes.reduce((t, c, i) => (this.active.has(c) ? i + 1 : t), 0);
    let tier = 0;
    if (m !== null) {
      const raise = m <= 0 ? 3 : m < this.th.restNowMin ? 2 : m < this.th.restSoonMin ? 1 : 0;
      const g = this.th.restMarginMin;
      const keep = m <= g ? 3 : m < this.th.restNowMin + g ? 2 : m < this.th.restSoonMin + g ? 1 : 0;
      tier = Math.max(raise, Math.min(curTier, keep));
    }
    codes.forEach((code, i) => {
      this.settle(
        d,
        now,
        code,
        tier === i + 1 && m !== null ? { level: levels[i]!, data: { minutes: m } } : null,
        { sticky: true, minUpdateMs: 60_000 },
      );
    });
  }

  private ruleSpeeding(d: AlertDelta, now: number, s: FullState): void {
    const limit = s.slow.nav.speedLimit;
    const speed = s.fast.speed;
    const on = this.active.has("speeding");
    const over = limit > 0 && speed > limit + (on ? this.th.speedingClearOverMs : this.th.speedingOverMs);
    this.settle(
      d,
      now,
      "speeding",
      over
        ? {
            level: "warning",
            data: { limit: round(limit, 2), speed: round(speed, 2) },
            rev: `${Math.round(limit * 3.6)}:${Math.floor((speed * 3.6) / 3)}`,
          }
        : null,
      { sticky: true, onFor: this.th.speedingForMs, offFor: 1000, minUpdateMs: 1000 },
    );
  }

  /** damage.hit: ≥ 2 pp wzrostu zużycia w < 5 s (kolizja); damage.high: zużycie > 50%. */
  private ruleDamage(d: AlertDelta, now: number, s: FullState): void {
    // nowy samochód/zapis albo pauza (ekran wczytywania) → nie traktuj skoku wartości jak kolizji
    const truckId = s.config.truck?.id ?? null;
    if (truckId !== this.truckId || s.status.paused || this.wasPaused) this.wearHistory.clear();
    this.truckId = truckId;
    this.wasPaused = s.status.paused;

    const parts: [string, number][] = TRUCK_PARTS.map((p) => [p, s.slow.wear[p]]);
    s.slow.trailers.forEach((t, i) => {
      if (!t.connected) return;
      parts.push([`trailer${i}.cargo`, t.cargoDamage], [`trailer${i}.chassis`, t.wear.chassis], [`trailer${i}.body`, t.wear.body]);
    });

    let best: { part: string; delta: number } | null = null;
    for (const [part, v] of parts) {
      const h = this.wearHistory.get(part) ?? [];
      this.wearHistory.set(part, h);
      while (h.length && now - h[0]!.t > this.th.damageHitWindowMs) h.shift();
      const base = h.length ? Math.min(...h.map((x) => x.v)) : v;
      h.push({ t: now, v });
      const delta = v - base;
      if (delta >= this.th.damageHitDelta - 1e-9 && (!best || delta > best.delta)) best = { part, delta };
    }
    if (best && now - this.lastHitAt >= this.th.damageHitCooldownMs) {
      this.lastHitAt = now;
      const id = `damage.hit:${now}`;
      const alert: Alert = {
        id,
        code: "damage.hit",
        level: "info",
        since: now,
        data: { part: best.part, delta: round(best.delta, 3) },
        sticky: false,
      };
      this.active.set(id, alert);
      this.expiries.set(id, now + this.th.oneShotTtlMs);
      d.raised.push(alert);
      // ta sama kolizja nie może wywołać drugiego alertu: przestaw bazę porównań na stan po uderzeniu
      for (const [part, v] of parts) this.wearHistory.set(part, [{ t: now, v }]);
    }

    // zużycie wysokie (tylko części ciągnika), histereza 0.5 / 0.45
    const on = this.active.has("damage.high");
    const limit = on ? this.th.damageHighClear : this.th.damageHighRaise;
    let worst: [string, number] | null = null;
    for (const p of TRUCK_PARTS) if (s.slow.wear[p] > limit && (!worst || s.slow.wear[p] > worst[1])) worst = [p, s.slow.wear[p]];
    this.settle(
      d,
      now,
      "damage.high",
      worst ? { level: "warning", data: { part: worst[0], wear: round(worst[1], 3) }, rev: worst[0] } : null,
      { sticky: true, onFor: 1000, offFor: 2000 },
    );
  }

  /** job.late: termin przekroczony (warning) albo prognoza GPS poza terminem (info). */
  private ruleJob(d: AlertDelta, now: number, s: FullState): void {
    const job = s.config.job;
    const deadline = job?.deliveryTime ?? null;
    let desired: Desired | null = null;
    if (deadline !== null && s.slow.time.game > 0) {
      const game = s.slow.time.game;
      if (game > deadline) {
        desired = { level: "warning", data: { overdueMin: game - deadline }, rev: "over" };
      } else if (s.slow.nav.time !== null && s.slow.nav.distance !== null) {
        const lateBy = game + s.slow.nav.time / 60 - deadline;
        const on = this.active.has("job.late");
        if (lateBy >= (on ? this.th.lateClearMin : this.th.lateRaiseMin))
          desired = { level: "info", data: { predictedLateMin: Math.round(lateBy) }, rev: "pred" };
      }
    }
    this.settle(d, now, "job.late", desired, { sticky: true, onFor: 10_000, offFor: 10_000, minUpdateMs: 30_000 });
  }

  // ───────────────────────────── mechanika ─────────────────────────────

  private settle(d: AlertDelta, now: number, id: string, want: Desired | null, o: SettleOpts = {}): void {
    const tr = this.tracks.get(id) ?? { onSince: null, offSince: null, rev: "", sentAt: 0 };
    this.tracks.set(id, tr);
    const cur = this.active.get(id);
    if (want) {
      tr.offSince = null;
      tr.onSince ??= now;
      const rev = `${want.level}|${want.rev ?? ""}`;
      if (!cur) {
        if (now - tr.onSince < (o.onFor ?? 0)) return;
        const alert = mk(id, want, now, o.sticky ?? true);
        this.active.set(id, alert);
        tr.rev = rev;
        tr.sentAt = now;
        d.raised.push(alert);
      } else if (rev !== tr.rev) {
        const levelChanged = cur.level !== want.level;
        if (!levelChanged && now - tr.sentAt < (o.minUpdateMs ?? 0)) return;
        const alert = mk(id, want, cur.since, o.sticky ?? true);
        this.active.set(id, alert);
        tr.rev = rev;
        tr.sentAt = now;
        d.raised.push(alert);
      }
    } else {
      tr.onSince = null;
      if (!cur) {
        tr.offSince = null;
        return;
      }
      tr.offSince ??= now;
      if (now - tr.offSince >= (o.offFor ?? 0)) {
        this.active.delete(id);
        tr.offSince = null;
        tr.rev = "";
        d.cleared.push(id);
      }
    }
  }
}

const flagOpts: SettleOpts = { sticky: true, onFor: 500, offFor: 1500 };

function mk(id: string, want: Desired, since: number, sticky: boolean): Alert {
  const a: Alert = { id, code: id as AlertCode, level: want.level, since, sticky };
  if (want.data) a.data = want.data;
  return a;
}

function finish(d: AlertDelta): AlertDelta | null {
  return d.raised.length || d.cleared.length ? d : null;
}

function round(v: number, digits: number): number {
  const p = 10 ** digits;
  return Math.round(v * p) / p;
}
