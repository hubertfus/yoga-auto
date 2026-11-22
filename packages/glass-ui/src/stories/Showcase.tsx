import { useEffect, useRef, useState } from "react";
import {
  Dock,
  Gauge,
  GlassButton,
  GlassCard,
  GlassPanel,
  GlassSegmented,
  GlassSlider,
  GlassToggle,
  Icon,
  Numeric,
  Sheet,
  StatusBar,
  Toast,
  ToastHost,
  type ToastProps,
  type ValueHandle,
} from "../index.ts";

const DOCK_ITEMS = [
  { id: "home", icon: <Icon name="home" />, label: "Start" },
  { id: "drive", icon: <Icon name="gauge" />, label: "Jazda" },
  { id: "truck", icon: <Icon name="truck" />, label: "Pojazd", badge: 2 },
  { id: "map", icon: <Icon name="map" />, label: "Mapa" },
  { id: "media", icon: <Icon name="music" />, label: "Media" },
];

export function DockDemo({ position = "left" as "left" | "bottom" }) {
  const [active, setActive] = useState("home");
  return <Dock items={DOCK_ITEMS} active={active} onSelect={setActive} position={position} />;
}

export function ButtonsDemo() {
  const [hold, setHold] = useState(false);
  const [lights, setLights] = useState(false);
  const [pending, setPending] = useState(false);
  const press = () => {
    setPending(true);
    setTimeout(() => {
      setPending(false);
      setLights((v) => !v);
    }, 900);
  };
  return (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
      <GlassButton size="lg" icon={<Icon name="lights-low" />} label="Mijania" active={lights} pending={pending} tone="lights" onPress={press} />
      <GlassButton size="lg" icon={<Icon name="lights-high" />} label="Drogowe" tone="beam" variant="filled" onPress={() => {}} />
      <GlassButton size="lg" icon={<Icon name="hazard" />} label="Awaryjne" tone="warn" onPress={() => {}} />
      <GlassButton size="lg" icon={<Icon name="beacon" />} label="Kogut" variant="plain" onPress={() => {}} />
      <GlassButton size="lg" icon={<Icon name="horn" />} label={hold ? "TRZYMANE" : "Klakson (hold)"} active={hold} onHoldStart={() => setHold(true)} onHoldEnd={() => setHold(false)} />
      <GlassButton size="xl" icon={<Icon name="parking-brake" />} label="Ręczny" tone="crit" variant="filled" active />
      <GlassButton size="md" icon={<Icon name="wipers" />} label="Wycieraczki" />
      <GlassButton size="sm" icon={<Icon name="settings" />} aria-label="Ustawienia" />
      <GlassButton size="md" label="Wyłączony" disabled />
    </div>
  );
}

export function ControlsDemo() {
  const [on, setOn] = useState(true);
  const [seg, setSeg] = useState<"off" | "park" | "low">("low");
  const [ret, setRet] = useState(2);
  const [vol, setVol] = useState(40);
  return (
    <div style={{ display: "grid", gap: 16, maxWidth: 520 }}>
      <GlassToggle checked={on} onChange={setOn} label="Klimatyzacja" />
      <GlassSegmented<"off" | "park" | "low">
        value={seg}
        onChange={setSeg}
        options={[
          { value: "off", label: "Wył." },
          { value: "park", label: "Postojowe" },
          { value: "low", label: "Mijania" },
        ]}
      />
      <GlassSlider min={0} max={5} step={1} value={ret} onChange={setRet} label="Retarder" format={(v) => `${v}/5`} />
      <div style={{ display: "flex", gap: 24, alignItems: "center" }}>
        <GlassSlider vertical min={0} max={100} value={vol} onChange={setVol} label="Głośność" />
        <Numeric initial={vol} format={(v) => `${Math.round(v)} %`} />
      </div>
    </div>
  );
}

export function GaugesDemo() {
  const speed = useRef<ValueHandle>(null);
  const rpm = useRef<ValueHandle>(null);
  const num = useRef<ValueHandle>(null);
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const s = (t - t0) / 1000;
      const v = 45 + 40 * Math.sin(s * 0.6);
      speed.current?.setValue(v);
      num.current?.setValue(v);
      rpm.current?.setValue(1100 + 700 * (1 + Math.sin(s * 0.9)));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div style={{ display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap" }}>
      <Gauge ref={rpm} min={0} max={2500} ticks={5} minorTicks={4} redline={2100} size={260} label="RPM ×100" tickLabel={(v) => String(v / 100)} spring="gauge" />
      <Gauge ref={speed} min={0} max={130} ticks={13} size={300} arc={260} spring="gauge">
        <Numeric ref={num} className="lg-display" format={(v) => String(Math.round(v))} />
      </Gauge>
    </div>
  );
}

export function SheetDemo() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <GlassButton size="lg" label="Otwórz arkusz" icon={<Icon name="settings" />} onPress={() => setOpen(true)} />
      <Sheet open={open} onClose={() => setOpen(false)} title="Ustawienia">
        <p style={{ margin: 0 }}>Przeciągnij w dół, aby zamknąć. Detenty: medium, large.</p>
        <ControlsDemo />
      </Sheet>
    </>
  );
}

let toastSeq = 0;
export function ToastDemo() {
  const [toasts, setToasts] = useState<ToastProps[]>([]);
  const add = (level: ToastProps["level"], title: string, body?: string) => {
    const id = `t${++toastSeq}`;
    const t: ToastProps = {
      id,
      level,
      title,
      icon: <Icon name={level === "critical" ? "critical" : level === "warning" ? "warning" : "info"} />,
      duration: 6000,
      ...(body ? { body } : {}),
      onDismiss: (x) => setToasts((l) => l.filter((y) => y.id !== x)),
    };
    setToasts((l) => [...l, t]);
  };
  return (
    <div style={{ display: "flex", gap: 12 }}>
      <GlassButton size="md" label="Info" onPress={() => add("info", "Połączono z grą", "Telemetria 60 Hz")} />
      <GlassButton size="md" label="Ostrzeżenie" tone="warn" onPress={() => add("warning", "Niski poziom paliwa", "Zasięg 94 km")} />
      <GlassButton size="md" label="Krytyczny" tone="crit" onPress={() => add("critical", "Awaria hamulców")} />
      <ToastHost toasts={toasts} />
    </div>
  );
}

export function StatusBarDemo() {
  return (
    <StatusBar
      left={<span>14:32 (gra 08:17)</span>}
      center={<span>⚠ Ograniczenie 80</span>}
      right={<span>● 12 ms · ♪ ▮▮</span>}
    />
  );
}

export function CardsDemo() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gridAutoRows: 150, gap: 16, maxWidth: 900 }}>
      <GlassCard size="2x2" accent="oklch(72% 0.17 245)" onPress={() => {}}>
        <div className="lg-label">PRĘDKOŚĆ</div>
        <Numeric initial={87} className="lg-display" />
      </GlassCard>
      <GlassCard size="2x1" onPress={() => {}}>Nawigacja · 184 km</GlassCard>
      <GlassCard size="1x1" onPress={() => {}} onLongPress={() => {}}>
        Przytrzymaj
      </GlassCard>
      <GlassCard size="1x1">Statyczna</GlassCard>
    </div>
  );
}

export function IconsDemo() {
  const names = [
    "lights-parking", "lights-low", "lights-high", "beacon", "hazard", "retarder", "engine-brake", "diff-lock",
    "lift-axle", "trailer", "coupling", "cruise", "parking-brake", "wipers", "ignition",
  ] as const;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 120px)", gap: 12 }}>
      {names.map((n) => (
        <GlassPanel key={n} padding={12} radius="md">
          <div style={{ display: "grid", placeItems: "center", gap: 6 }}>
            <Icon name={n} size={40} />
            <small>{n}</small>
          </div>
        </GlassPanel>
      ))}
    </div>
  );
}

/** Wszystko naraz — do porównania tierów. */
export function Everything() {
  return (
    <div style={{ display: "grid", gap: 20, paddingLeft: 120 }}>
      <DockDemo />
      <StatusBarDemo />
      <GlassPanel title="Światła i sygnały" padding={20}>
        <ButtonsDemo />
      </GlassPanel>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <GlassPanel title="Sterowanie" tint="strong" padding={20}>
          <ControlsDemo />
        </GlassPanel>
        <GlassPanel title="Zegary" padding={20}>
          <GaugesDemo />
        </GlassPanel>
      </div>
      <CardsDemo />
      <SheetDemo />
      <ToastDemo />
    </div>
  );
}

export { Toast };
