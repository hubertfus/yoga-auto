/** Ekran „Jazda” (DESIGN §6.2): duży zegar RPM ze środkiem prędkość/bieg, limit, CC, retarder, powietrze, kierunkowskazy. */
import { useRef } from "react";
import { Icon } from "@yoga-auto/glass-ui";
import { registerScreen } from "../../core/registry.ts";
import { useConfig, useFast, useFastValue, useSlow } from "../../core/store.ts";
import { ActionButton } from "../_shared/actions.tsx";
import { Bar, FastGauge, FastNumeric, Stat, levelTone } from "../_shared/shared.tsx";
import { GearBadge, LimitSign, isOverspeed } from "../gauges/index.tsx";
import { BlinkerArrow } from "../lights/index.tsx";
import { formatLimit, formatPercent, formatPressure, formatSpeed, speedLabel, useUnits } from "../units/index.ts";

function DriveScreen() {
  const u = useUnits();
  const rpmLimit = useConfig((c) => c.truck?.rpmLimit ?? 2500);
  const steps = useConfig((c) => c.truck?.retarderSteps ?? 0);
  const fuelCap = useConfig((c) => c.truck?.fuelCapacity ?? 0);
  const limitMs = useSlow((s) => s.nav.speedLimit);
  const limitRef = useRef(limitMs);
  limitRef.current = limitMs;
  const cruise = useFast((f) => f.cruise);
  const retarder = useFast((f) => f.retarder);
  const air = useSlow((s) => s.air);
  const fuel = useSlow((s) => s.fuel);
  const max = Math.max(1000, Math.ceil(rpmLimit / 500) * 500);
  const fuelFraction = fuelCap > 0 ? fuel.amount / fuelCap : null;
  const speedBox = useRef<HTMLDivElement>(null);
  useFastValue(
    (f) => isOverspeed(f.speed, limitRef.current),
    (over) => speedBox.current?.setAttribute("data-over", String(over)),
  );

  return (
    <div className="ft-screen" data-testid="drive-screen">
      <div className="ft-row" style={{ flex: 1, minHeight: 0, justifyContent: "space-around", gap: "var(--s-5)" }}>
        <BlinkerArrow side="left" size={64} />
        <div ref={speedBox} className="ft-overtext" data-over="false">
          <FastGauge
            select={(f) => f.rpm}
            min={0}
            max={max}
            ticks={max / 500}
            minorTicks={1}
            redline={rpmLimit * 0.9}
            size={440}
            label="Obroty silnika"
            tickLabel={(v) => String(v / 100)}
          >
            <div style={{ textAlign: "center", transform: "translateY(22%)" }}>
              <div style={{ font: "var(--t-display)" }}>
                <FastNumeric key={u.speed} select={(f) => f.speed} format={(v) => formatSpeed(v, u)} />
              </div>
              <div className="ft-unit" style={{ margin: 0 }}>
                {speedLabel(u)}
              </div>
              <div style={{ marginTop: "var(--s-2)" }}>
                <GearBadge />
              </div>
            </div>
          </FastGauge>
        </div>
        <div style={{ display: "grid", gap: "var(--s-4)", minWidth: 280 }}>
          <div className="ft-row">
            <LimitSign limit={formatLimit(limitMs, u)} big />
            <Stat label="Tempomat" value={cruise > 0.1 ? formatSpeed(cruise, u) : "wył."} unit={cruise > 0.1 ? speedLabel(u) : undefined} />
          </div>
          <div>
            <div className="ft-spread ft-dim">
              <span>Retarder</span>
              <span className="ft-tab">
                {retarder}/{steps}
              </span>
            </div>
            <Bar value={steps > 0 ? retarder / steps : 0} segments={Math.max(steps, 1)} />
          </div>
          <Stat
            label="Powietrze"
            value={formatPressure(air.pressure)}
            tone={air.emergency ? "crit" : air.warning ? "warn" : undefined}
          />
          <div>
            <div className="ft-spread ft-dim">
              <span>
                <Icon name="fuel" size={16} /> Paliwo
              </span>
              <span className="ft-tab">{formatPercent(fuelFraction)}</span>
            </div>
            <Bar value={fuelFraction} tone={levelTone(fuelFraction, fuel.warning)} />
          </div>
        </div>
        <BlinkerArrow side="right" size={64} />
      </div>
      <div className="ft-row" style={{ justifyContent: "center", flexWrap: "wrap" }}>
        <ActionButton id="blinker.left" size="lg" label="Kier." />
        <ActionButton id="lights.hazard" size="lg" label="" showLabel={false} />
        <ActionButton id="blinker.right" size="lg" label="Kier." />
        <ActionButton id="parkingBrake.toggle" size="lg" label="Ręczny" />
        <ActionButton id="motorBrake.toggle" size="lg" label="Silnikowy" />
        <ActionButton id="retarder.down" size="lg" label="Retarder −" />
        <ActionButton id="retarder.up" size="lg" label="Retarder +" />
      </div>
    </div>
  );
}

registerScreen({ id: "drive", label: "Jazda", icon: "gauge", order: 10, component: DriveScreen });
