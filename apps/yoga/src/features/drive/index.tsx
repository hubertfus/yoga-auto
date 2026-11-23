/**
 * Ekran „Jazda”: zestaw wskaźników jak w kabinie. Pasek kontrolek u góry, prędkościomierz (znaczniki limitu
 * i tempomatu) i obrotomierz (pole eko i czerwone, bieg), pośrodku panel trasy (limit, tempomat, najbliższy manewr,
 * cel, przyjazd, odpoczynek, retarder), pod spodem małe zegary eksploatacyjne. Co widać, wybiera kierowca
 * (arkusz „Dostosuj”, layout.ts); przyciski akcji na dole tylko te, które sam doda.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { GlassButton, Icon } from "@yoga-auto/glass-ui";
import { registerScreen } from "../../core/registry.ts";
import { useConfig, useFast, useFastValue, useSlow } from "../../core/store.ts";
import { ActionButton } from "../_shared/actions.tsx";
import { gearLabel } from "../_shared/shared.tsx";
import { LimitSign } from "../gauges/index.tsx";
import { NextManeuver, RouteRemaining } from "../route/index.tsx";
import {
  PSI_TO_BAR,
  formatArrival,
  formatConsumption,
  formatDistance,
  formatDuration,
  formatGameTime,
  formatKm,
  formatLimit,
  formatMinutes,
  formatSpeed,
  formatVolume,
  speedLabel,
  speedValue,
  tempValue,
  useUnits,
  volumeLabel,
} from "../units/index.ts";
import { CustomizeSheet } from "./Customize.tsx";
import { Dial, type DialMarker, type DialZone } from "./Dial.tsx";
import { useDriveLayout, type FactId, type GaugeId } from "./layout.ts";
import { MiniGauge } from "./MiniGauge.tsx";
import { Telltales } from "./Telltales.tsx";
import { rpmScale, speedScale } from "./dial.ts";
import "./drive.css";

const tickSpeed = (v: number) => String(v);
const tickRpm = (v: number) => String(v / 100);

function Speedometer() {
  const u = useUnits();
  const range = useDriveLayout().speedRange;
  const scale = speedScale(u, range);
  const limitMs = useSlow((s) => s.nav.speedLimit);
  const cruiseMs = useFast((f) => Math.round(f.cruise * 10) / 10);
  const limit = limitMs > 0.1 ? Math.round(speedValue(limitMs, u)) : null;
  const cruise = cruiseMs > 0.1 ? Math.round(speedValue(cruiseMs, u)) : null;
  const markers = useMemo(() => {
    const m: DialMarker[] = [];
    if (limit !== null) m.push({ value: limit, tone: "crit", label: `Ograniczenie ${limit} ${speedLabel(u)}` });
    if (cruise !== null) m.push({ value: cruise, tone: "on", label: `Tempomat ${cruise} ${speedLabel(u)}` });
    return m;
  }, [limit, cruise, u]);
  const select = useCallback((f: { speed: number }) => speedValue(Math.abs(f.speed), u), [u]);
  return (
    <Dial
      key={`${u.speed}${range}`}
      select={select}
      max={scale.max}
      major={scale.major}
      minor={scale.minor}
      tickLabel={tickSpeed}
      markers={markers}
      overAt={limit === null ? null : limit + 1}
      label="Prędkościomierz"
      testid="drive-speedo"
    >
      <span className="dl-big" data-testid="drive-speed">
        <SpeedDigits />
      </span>
      <span className="dl-unit">{speedLabel(u)}</span>
    </Dial>
  );
}

/** Cyfry prędkości (imperatywnie, bez re-renderu). */
function SpeedDigits() {
  const u = useUnits();
  const el = useRef<HTMLSpanElement>(null);
  useFastValue(
    (f) => formatSpeed(f.speed, u),
    (t) => {
      if (el.current) el.current.textContent = t;
    },
  );
  return <span ref={el}>0</span>;
}

function RpmDigits() {
  const el = useRef<HTMLSpanElement>(null);
  useFastValue(
    (f) => Math.round(f.rpm / 50) * 50,
    (v) => {
      if (el.current) el.current.textContent = String(v);
    },
  );
  return <span ref={el}>0</span>;
}

function Tachometer() {
  const rpmLimit = useConfig((c) => c.truck?.rpmLimit ?? 2500);
  const rev = useConfig((c) => c.truck?.reverseGears ?? 1);
  const gear = useFast((f) => f.gear);
  const s = rpmScale(rpmLimit);
  const zones = useMemo<DialZone[]>(
    () => [
      { from: s.eco[0], to: s.eco[1], tone: "eco" },
      { from: s.red, to: s.max, tone: "crit" },
    ],
    [s.eco[0], s.eco[1], s.red, s.max],
  );
  return (
    <Dial
      select={(f) => f.rpm}
      max={s.max}
      major={s.major}
      minor={s.minor}
      tickLabel={tickRpm}
      zones={zones}
      label="Obrotomierz"
      testid="drive-tacho"
    >
      <span key={gear} className="dl-gear" data-testid="drive-gear" aria-label="Bieg">
        {gearLabel(gear, rev)}
      </span>
      <span className="dl-unit">
        <RpmDigits /> obr/min
      </span>
    </Dial>
  );
}

/** Panel środkowy: to, czego kierowca szuka w trasie. */
function TripPanel({ facts }: { facts: readonly FactId[] }) {
  const u = useUnits();
  const has = (f: FactId) => facts.includes(f);
  const limitMs = useSlow((s) => s.nav.speedLimit);
  const cruise = useFast((f) => Math.round(f.cruise * 10) / 10);
  const navDist = useSlow((s) => s.nav.distance);
  const navTime = useSlow((s) => s.nav.time);
  const gameMin = useSlow((s) => s.time.game);
  const rest = useSlow((s) => s.time.restStopMin);
  const retarder = useFast((f) => f.retarder);
  const motorBrake = useFast((f) => f.motorBrake);
  const steps = useConfig((c) => c.truck?.retarderSteps ?? 0);
  const job = useConfig((c) => c.job);
  const restTone = rest === null ? undefined : rest <= 0 ? "crit" : rest <= 60 ? "warn" : undefined;
  const hasNav = navDist !== null && navDist > 1;
  return (
    <div className="dr-mfd" data-testid="drive-mfd">
      <div className="dr-mfd__top">
        <LimitSign limit={formatLimit(limitMs, u)} big />
        <div className="dr-cc" data-on={cruise > 0.1 || undefined}>
          <Icon name="cruise" size={22} />
          <span className="dr-cc__v">{cruise > 0.1 ? formatSpeed(cruise, u) : "–"}</span>
          <span className="dr-cc__u">{cruise > 0.1 ? speedLabel(u) : "tempomat"}</span>
        </div>
      </div>
      <div className="dr-mfd__nav">
        <NextManeuver compact />
      </div>
      <dl className="dr-facts">
        {has("remaining") ? (
          <div>
            <dt>Do celu</dt>
            <dd data-testid="drive-remaining">{hasNav ? formatDistance(navDist, u) : <RouteRemaining />}</dd>
          </div>
        ) : null}
        {has("arrival") ? (
          <div>
            <dt>Przyjazd</dt>
            <dd>{hasNav ? formatArrival(gameMin, navTime) : "–"}</dd>
          </div>
        ) : null}
        {has("clock") ? (
          <div>
            <dt>Godzina</dt>
            <dd>{formatGameTime(gameMin)}</dd>
          </div>
        ) : null}
        {has("rest") ? (
          <div data-tone={restTone}>
            <dt>Odpoczynek</dt>
            <dd data-testid="drive-rest">
              {rest === null ? "–" : rest < 0 ? `−${formatMinutes(-rest)}` : formatMinutes(rest)}
            </dd>
          </div>
        ) : null}
      </dl>
      {job && has("job") ? (
        <div className="dr-job" title="Cel zlecenia">
          <Icon name={job.kind === "bus" ? "bus" : "cargo"} size={16} />
          <span>{job.destination.city || "–"}</span>
          {job.deliveryTime !== null ? <span className="ft-dim">· do {formatGameTime(job.deliveryTime)}</span> : null}
        </div>
      ) : null}
      {has("retarder") ? (
        <div className="dr-ret">
          <span className="dr-ret__k">
            <Icon name="retarder" size={16} /> Retarder
          </span>
          <span className="dr-ret__bar" aria-label={`Retarder ${retarder} z ${steps}`}>
            {Array.from({ length: Math.max(steps, 1) }, (_, i) => (
              <i key={i} data-on={i < retarder || undefined} />
            ))}
          </span>
          <span className="dr-ret__mb" data-on={motorBrake || undefined}>
            <Icon name="engine-brake" size={16} />
          </span>
        </div>
      ) : null}
    </div>
  );
}

/** Małe zegary: paliwo, AdBlue, powietrze, woda, olej, akumulator. */
function Instruments({ show }: { show: readonly GaugeId[] }) {
  const u = useUnits();
  const on = (g: GaugeId) => show.includes(g);
  const fuel = useSlow((s) => s.fuel);
  const adblue = useSlow((s) => s.adblue);
  const air = useSlow((s) => s.air);
  const temps = useSlow((s) => s.temps);
  const oilP = useSlow((s) => s.oilPressure);
  const waterWarn = useSlow((s) => s.waterTempWarning);
  const battery = useSlow((s) => s.battery);
  const odometer = useSlow((s) => s.odometer);
  const instant = useSlow((s) => s.trip.instantConsumption);
  const truck = useConfig((c) => c.truck);
  const fuelCap = truck?.fuelCapacity ?? 0;
  const adCap = truck?.adblueCapacity ?? 0;
  const fuelPct = fuelCap > 0 ? (fuel.amount / fuelCap) * 100 : null;
  const adPct = adCap > 0 ? (adblue.amount / adCap) * 100 : null;
  const fuelWarnPct = (truck?.fuelWarningFactor ?? 0.15) * 100;
  // powietrze: bar w metrycznych, psi w imperialnych; pola ostrzeżenia i awarii z konfiguracji pojazdu
  const bar = u.speed !== "mph";
  const k = bar ? PSI_TO_BAR : 1;
  const airMax = bar ? 12 : 150;
  const airWarn = (truck?.airPressureWarning ?? 65) * k;
  const airEmerg = (truck?.airPressureEmergency ?? 35) * k;
  const airVal = Number.isFinite(air.pressure) ? air.pressure * k : null;
  const airText =
    airVal === null ? "–" : bar ? `${airVal.toFixed(1).replace(".", ",")} bar` : `${Math.round(airVal)} psi`;
  const f = u.temp === "f";
  const tMin = tempValue(40, u);
  const tMax = tempValue(130, u);
  const temp = (c: number) => (Number.isFinite(c) ? tempValue(c, u) : null);
  const tText = (c: number) => (Number.isFinite(c) ? `${Math.round(tempValue(c, u))}°` : "–");
  const volt = Number.isFinite(battery.voltage) ? battery.voltage : null;
  return (
    <div className="dr-inst">
      {on("fuel") ? (
        <MiniGauge
          icon="fuel"
          label="Paliwo"
          value={fuelPct}
          min={0}
          max={100}
          text={fuelPct === null ? "–" : `${Math.round(fuelPct)}%`}
          sub={`${formatKm(fuel.rangeKm, u)} · ${formatVolume(fuel.amount, u)} ${volumeLabel(u)}`}
          ends={["0", "1/1"]}
          zones={[{ from: 0, to: fuelWarnPct, tone: "crit" }]}
          {...(fuel.warning ? { tone: "warn" as const } : {})}
          testid="drive-fuel"
        />
      ) : null}
      {on("adblue") ? (
        <MiniGauge
          icon="adblue"
          label="AdBlue"
          value={adPct}
          min={0}
          max={100}
          text={adPct === null ? "–" : `${Math.round(adPct)}%`}
          ends={["0", "1/1"]}
          zones={[{ from: 0, to: 5, tone: "crit" }]}
          {...(adblue.warning ? { tone: "warn" as const } : {})}
        />
      ) : null}
      {on("air") ? (
        <MiniGauge
          icon="air"
          label="Powietrze"
          value={airVal}
          min={0}
          max={airMax}
          text={airText}
          ends={["0", String(airMax)]}
          zones={[
            { from: 0, to: airEmerg, tone: "crit" },
            { from: airEmerg, to: airWarn, tone: "warn" },
          ]}
          {...(air.emergency ? { tone: "crit" as const } : air.warning ? { tone: "warn" as const } : {})}
          testid="drive-air"
        />
      ) : null}
      {on("water") ? (
        <MiniGauge
          icon="thermometer"
          label="Płyn chłodz."
          value={temp(temps.water)}
          min={tMin}
          max={tMax}
          text={tText(temps.water)}
          ends={[f ? "104" : "40", f ? "266" : "130"]}
          zones={[{ from: tempValue(105, u), to: tMax, tone: "crit" }]}
          {...(waterWarn ? { tone: "crit" as const } : {})}
        />
      ) : null}
      {on("oil") ? (
        <MiniGauge
          icon="oil"
          label="Olej"
          value={temp(temps.oil)}
          min={tMin}
          max={tMax}
          text={tText(temps.oil)}
          sub={
            Number.isFinite(oilP.value)
              ? `${bar ? (oilP.value * PSI_TO_BAR).toFixed(1).replace(".", ",") + " bar" : Math.round(oilP.value) + " psi"}`
              : undefined
          }
          ends={[f ? "104" : "40", f ? "266" : "130"]}
          zones={[{ from: tempValue(115, u), to: tMax, tone: "crit" }]}
          {...(oilP.warning ? { tone: "crit" as const } : {})}
        />
      ) : null}
      {on("battery") ? (
        <MiniGauge
          icon="battery"
          label="Akumulator"
          value={volt}
          min={20}
          max={30}
          text={volt === null ? "–" : `${volt.toFixed(1).replace(".", ",")} V`}
          ends={["20", "30"]}
          zones={[{ from: 20, to: 23, tone: "crit" }]}
          {...(battery.warning ? { tone: "warn" as const } : {})}
        />
      ) : null}
      {on("odo") ? (
        <div className="dr-odo" data-testid="drive-odo">
          <div>
            <span className="dr-odo__k">Przebieg</span>
            <span className="dr-odo__v">{formatKm(odometer, u)}</span>
          </div>
          <div>
            <span className="dr-odo__k">Spalanie</span>
            <span className="dr-odo__v">{formatConsumption(instant, u)}</span>
          </div>
          <div>
            <span className="dr-odo__k">Czas do celu</span>
            <span className="dr-odo__v">
              <TimeLeft />
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TimeLeft() {
  const t = useSlow((s) => s.nav.time);
  return <>{t !== null && t > 0 ? formatDuration(t) : "–"}</>;
}

function DriveScreen() {
  const l = useDriveLayout();
  const [edit, setEdit] = useState(false);
  return (
    <div className="dr" data-testid="drive-screen" data-panel={l.panel ? "on" : "off"}>
      {l.telltales ? <Telltales /> : null}
      <div className="dr-main">
        <div className="dr-dial">
          <Speedometer />
        </div>
        {l.panel ? <TripPanel facts={l.facts} /> : null}
        <div className="dr-dial">
          <Tachometer />
        </div>
        {/* w rogu obok obrotomierza (okrągły zegar zostawia tam wolne miejsce) */}
        <GlassButton
          size="md"
          icon={<Icon name="settings" />}
          aria-label="Dostosuj ekran"
          className="dr-edit"
          onPress={() => setEdit(true)}
          data-testid="drive-customize-open"
        />
      </div>
      {l.gauges.length ? <Instruments show={l.gauges} /> : null}
      {l.actions.length ? (
        <div className="dr-actions" data-testid="drive-actions">
          {l.actions.map((a) => (
            <ActionButton key={a} id={a} size="lg" />
          ))}
        </div>
      ) : null}
      <CustomizeSheet open={edit} onClose={() => setEdit(false)} />
    </div>
  );
}

registerScreen({ id: "drive", label: "Jazda", icon: "gauge", order: 10, component: DriveScreen });
