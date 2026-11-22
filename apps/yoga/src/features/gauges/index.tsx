/** Widgety zegarów (Home): speed, rpm, fuel, cruise, rest, status. Szybkie wartości wyłącznie imperatywnie. */
import { useRef } from "react";
import { GlassButton, Icon } from "@yoga-auto/glass-ui";
import { sendCmd, usePending } from "../../core/commands.ts";
import { registerWidget, type WidgetProps } from "../../core/registry.ts";
import { useConfig, useFast, useFastValue, useSlow } from "../../core/store.ts";
import { Bar, CardTitle, FastBar, FastGauge, FastNumeric, Stat, gearLabel, levelTone } from "../_shared/shared.tsx";
import {
  formatKm,
  formatLimit,
  formatMinutes,
  formatPercent,
  formatPressure,
  formatSpeed,
  formatTemp,
  formatVolume,
  speedLabel,
  useUnits,
  volumeLabel,
} from "../units/index.ts";

/** Tolerancja nad limitem (m/s ≈ 1 km/h), zanim zapali się rim „przekroczenie prędkości”. */
export const OVERSPEED_TOLERANCE = 0.28;

export function isOverspeed(speed: number, limit: number): boolean {
  return limit > 0.1 && Math.abs(speed) > limit + OVERSPEED_TOLERANCE;
}

export function LimitSign({ limit, big }: { limit: string; big?: boolean }) {
  const none = limit === "–";
  return (
    <span className="ft-limit" data-none={none || undefined} data-big={big || undefined} title="Ograniczenie prędkości">
      {limit}
    </span>
  );
}

export function GearBadge() {
  const gear = useFast((f) => f.gear);
  const rev = useConfig((c) => c.truck?.reverseGears ?? 1);
  return (
    <span key={gear} className="ft-gear" aria-label="Bieg">
      {gearLabel(gear, rev)}
    </span>
  );
}

function SpeedWidget({ size }: WidgetProps) {
  const u = useUnits();
  const limitMs = useSlow((s) => s.nav.speedLimit);
  const limitRef = useRef(limitMs);
  limitRef.current = limitMs;
  const root = useRef<HTMLDivElement>(null);
  useFastValue(
    (f) => isOverspeed(f.speed, limitRef.current),
    (over) => root.current?.setAttribute("data-over", String(over)),
  );
  const cruise = useFast((f) => f.cruise);
  const fuelAmount = useSlow((s) => s.fuel.amount);
  const capacity = useConfig((c) => c.truck?.fuelCapacity ?? 0);
  const fuelFraction = capacity > 0 ? fuelAmount / capacity : null;
  const compact = size === "1x1";

  return (
    <div ref={root} className="ft-root ft-rim" data-over="false">
      <CardTitle icon={<Icon name="speedometer" size={18} />}>Prędkość</CardTitle>
      <div className="ft-spread ft-grow">
        <div>
          <span style={{ font: compact ? "700 72px/1 var(--font-family)" : "var(--t-display)" }}>
            <FastNumeric key={u.speed} select={(f) => f.speed} format={(v) => formatSpeed(v, u)} />
          </span>
          <span className="ft-unit">{speedLabel(u)}</span>
        </div>
        <LimitSign limit={formatLimit(limitMs, u)} big={!compact} />
      </div>
      <div className="ft-row">
        <GearBadge />
        <span className="ft-mid" data-testid="speed-cruise">
          {cruise > 0.1 ? (
            <>
              <span className="ft-dim">CC </span>
              {formatSpeed(cruise, u)}
            </>
          ) : (
            <span className="ft-dimmer">CC –</span>
          )}
        </span>
        <span className="ft-grow" />
        {!compact ? (
          <span className="ft-row ft-dim" style={{ gap: "var(--s-2)" }}>
            <Icon name="fuel" size={18} />
            {formatPercent(fuelFraction)}
          </span>
        ) : null}
      </div>
      <FastBar select={(f) => f.rpm / 2500} />
    </div>
  );
}

function RpmWidget() {
  const limit = useConfig((c) => c.truck?.rpmLimit ?? 2500);
  const max = Math.max(1000, Math.ceil(limit / 500) * 500);
  return (
    <div className="ft-root" style={{ alignItems: "center" }}>
      <CardTitle icon={<Icon name="gauge" size={18} />}>Obroty</CardTitle>
      <FastGauge
        select={(f) => f.rpm}
        min={0}
        max={max}
        ticks={max / 500}
        minorTicks={1}
        redline={limit * 0.9}
        size={210}
        label="Obroty silnika"
        tickLabel={(v) => String(v / 100)}
      >
        <div style={{ textAlign: "center", transform: "translateY(24%)" }}>
          <div className="ft-mid">
            <FastNumeric select={(f) => f.rpm} spring="gauge" />
          </div>
          <div style={{ marginTop: 4 }}>
            <GearBadge />
          </div>
        </div>
      </FastGauge>
    </div>
  );
}

function FuelWidget() {
  const u = useUnits();
  const amount = useSlow((s) => s.fuel.amount);
  const rangeKm = useSlow((s) => s.fuel.rangeKm);
  const warning = useSlow((s) => s.fuel.warning);
  const adblue = useSlow((s) => s.adblue.amount);
  const adWarn = useSlow((s) => s.adblue.warning);
  const cap = useConfig((c) => c.truck?.fuelCapacity ?? 0);
  const adCap = useConfig((c) => c.truck?.adblueCapacity ?? 0);
  const fraction = cap > 0 ? amount / cap : null;
  const adFraction = adCap > 0 ? adblue / adCap : null;
  return (
    <div className="ft-root">
      <CardTitle icon={<Icon name="fuel" size={18} />}>Paliwo</CardTitle>
      <div className="ft-big" data-tone={warning ? "warn" : undefined} style={warning ? { color: "var(--warn)" } : undefined}>
        {formatPercent(fraction)}
      </div>
      <Bar value={fraction} tone={levelTone(fraction, warning)} />
      <div className="ft-spread ft-dim">
        <span>{formatKm(rangeKm, u)}</span>
        <span className="ft-tab">
          {formatVolume(amount, u)} {volumeLabel(u)}
        </span>
      </div>
      <div className="ft-grow" />
      <div className="ft-spread ft-dim">
        <span>AdBlue</span>
        <span className="ft-tab">{formatPercent(adFraction)}</span>
      </div>
      <Bar value={adFraction} tone={levelTone(adFraction, adWarn, 0.03)} />
    </div>
  );
}

function CruiseWidget() {
  const u = useUnits();
  const cruise = useFast((f) => f.cruise);
  const on = cruise > 0.1;
  const pSet = usePending("cruise.set");
  const pInc = usePending("cruise.inc");
  const pDec = usePending("cruise.dec");
  const pRes = usePending("cruise.resume");
  return (
    <div className="ft-root">
      <CardTitle icon={<Icon name="cruise" size={18} />}>Tempomat</CardTitle>
      <div className="ft-spread">
        <GlassButton size="md" icon={<Icon name="minus" />} aria-label="Tempomat minus" pending={pDec} onPress={() => void sendCmd("cruise.dec")} />
        <div style={{ textAlign: "center" }}>
          <div className="ft-big" style={on ? undefined : { color: "var(--text-3)" }}>
            {on ? formatSpeed(cruise, u) : "–"}
          </div>
          <div className="ft-dim" style={{ font: "var(--t-caption)" }}>
            {speedLabel(u)}
          </div>
        </div>
        <GlassButton size="md" icon={<Icon name="plus" />} aria-label="Tempomat plus" pending={pInc} onPress={() => void sendCmd("cruise.inc")} />
      </div>
      <div className="ft-grow" />
      <div className="ft-row">
        <GlassButton size="md" label="SET" tone="on" active={on} pending={pSet} onPress={() => void sendCmd("cruise.set")} className="ft-grow" />
        <GlassButton size="md" label="RES" pending={pRes} onPress={() => void sendCmd("cruise.resume")} className="ft-grow" />
      </div>
    </div>
  );
}

function RestWidget() {
  const rest = useSlow((s) => s.time.restStopMin);
  const tone = rest === null ? undefined : rest <= 0 ? "crit" : rest <= 60 ? "warn" : undefined;
  return (
    <div className="ft-root">
      <CardTitle icon={<Icon name="bed" size={18} />}>Odpoczynek</CardTitle>
      <div className="ft-grow" />
      <div className="ft-big" style={tone ? { color: `var(--${tone})` } : undefined} data-testid="rest-value">
        {rest === null ? "–" : rest < 0 ? `−${formatMinutes(-rest)}` : formatMinutes(rest)}
      </div>
      <div className="ft-dim">{rest === null ? "brak danych" : rest <= 0 ? "limit przekroczony" : "do wymaganego odpoczynku"}</div>
    </div>
  );
}

function StatusWidget() {
  const u = useUnits();
  const air = useSlow((s) => s.air);
  const temps = useSlow((s) => s.temps);
  const battery = useSlow((s) => s.battery);
  const oilP = useSlow((s) => s.oilPressure);
  const waterWarn = useSlow((s) => s.waterTempWarning);
  return (
    <div className="ft-root">
      <CardTitle icon={<Icon name="activity" size={18} />}>Stan pojazdu</CardTitle>
      <div className="ft-grow" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "var(--s-3)", alignContent: "center" }}>
        <Stat label="Powietrze" value={formatPressure(air.pressure)} tone={air.emergency ? "crit" : air.warning ? "warn" : undefined} />
        <Stat label="Olej" value={formatTemp(temps.oil, u)} />
        <Stat label="Woda" value={formatTemp(temps.water, u)} tone={waterWarn ? "warn" : undefined} />
        <Stat label="Hamulce" value={formatTemp(temps.brake, u)} />
        <Stat label="Akumulator" value={`${Number.isFinite(battery.voltage) ? battery.voltage.toFixed(1) : "–"} V`} tone={battery.warning ? "warn" : undefined} />
        <Stat label="Ciśn. oleju" value={formatPressure(oilP.value)} tone={oilP.warning ? "crit" : undefined} />
      </div>
    </div>
  );
}

registerWidget({ id: "speed", label: "Prędkość", size: "2x1", sizes: ["2x1"], component: SpeedWidget, opens: "drive" });
registerWidget({ id: "rpm", label: "Obroty", size: "1x1", component: RpmWidget, opens: "drive" });
registerWidget({ id: "fuel", label: "Paliwo", size: "1x1", component: FuelWidget, opens: "trip" });
registerWidget({ id: "cruise", label: "Tempomat", size: "1x1", component: CruiseWidget });
registerWidget({ id: "rest", label: "Odpoczynek", size: "1x1", component: RestWidget, opens: "nav" });
registerWidget({ id: "status", label: "Stan pojazdu", size: "2x1", sizes: ["2x1"], component: StatusWidget, opens: "vehicle" });
