/** Wspólne klocki widgetów S5: szybkie liczby bez re-renderu, paski, nagłówki. */
import { useRef, type ComponentProps, type ReactNode } from "react";
import { Gauge, Numeric, type GaugeProps, type ValueHandle } from "@yoga-auto/glass-ui";
import type { FastState } from "@yoga-auto/protocol";
import { useFastValue } from "../../core/store.ts";
import "./features.css";

type SpringName = NonNullable<ComponentProps<typeof Numeric>["spring"]>;

/** Liczba z kanału fast: aktualizacja imperatywna (rAF), komponent nie re-renderuje się przy zmianach wartości. */
export function FastNumeric({
  select,
  format,
  spring,
  className,
}: {
  select: (f: FastState) => number;
  format?: (v: number) => string;
  spring?: SpringName;
  className?: string;
}) {
  const ref = useRef<ValueHandle>(null);
  useFastValue(select, (v) => ref.current?.setValue(v));
  return (
    <Numeric
      ref={ref}
      {...(format ? { format } : {})}
      {...(spring ? { spring } : {})}
      {...(className ? { className } : {})}
    />
  );
}

/** Zegar łukowy z kanału fast (sprężyna gauge interpoluje między ramkami 30 Hz → 60 fps). */
export function FastGauge({ select, ...gauge }: { select: (f: FastState) => number } & Omit<GaugeProps, "initial">) {
  const ref = useRef<ValueHandle>(null);
  useFastValue(select, (v) => ref.current?.setValue(v));
  return <Gauge ref={ref} {...gauge} />;
}

/** Pasek 0..1 z kanału fast (np. RPM), szerokość ustawiana imperatywnie. */
export function FastBar({ select, tone }: { select: (f: FastState) => number; tone?: "ok" | "warn" | "crit" }) {
  const fill = useRef<HTMLElement>(null);
  useFastValue(select, (v) => {
    if (fill.current) fill.current.style.width = `${Math.max(0, Math.min(1, v)) * 100}%`;
  });
  return (
    <div className="ft-bar" data-tone={tone ?? "ok"} role="presentation">
      <i ref={fill} style={{ transition: "none" }} />
    </div>
  );
}

/** Pasek postępu 0..1 (re-render tylko przy zmianie wartości z kanału slow). */
export function Bar({
  value,
  tone = "ok",
  segments,
}: {
  value: number | null;
  tone?: "ok" | "warn" | "crit";
  segments?: number;
}) {
  const v = value === null || !Number.isFinite(value) ? 0 : Math.max(0, Math.min(1, value));
  return (
    <div
      className="ft-bar"
      data-tone={tone}
      data-segments={segments || undefined}
      role="progressbar"
      aria-valuenow={Math.round(v * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      {segments ? (
        Array.from({ length: segments }, (_, i) => <i key={i} data-on={i < Math.round(v * segments) || undefined} />)
      ) : (
        <i style={{ width: `${v * 100}%` }} />
      )}
    </div>
  );
}

export function CardTitle({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
  return (
    <div className="ft-title">
      {icon}
      <span>{children}</span>
    </div>
  );
}

export function Stat({
  label,
  value,
  tone,
  unit,
}: {
  label: ReactNode;
  value: ReactNode;
  tone?: "warn" | "crit" | undefined;
  unit?: ReactNode;
}) {
  return (
    <div className="ft-stat" data-tone={tone}>
      <span className="ft-stat__label">{label}</span>
      <span className="ft-stat__value">
        {value}
        {unit ? <small>{unit}</small> : null}
      </span>
    </div>
  );
}

/** Ton paska: crit poniżej progu krytycznego, warn gdy flaga ostrzeżenia z gry. */
export const levelTone = (fraction: number | null, warning: boolean, critBelow = 0.05): "ok" | "warn" | "crit" =>
  fraction !== null && fraction <= critBelow ? "crit" : warning ? "warn" : "ok";

/** Bieg → tekst: >0 numer, 0 → N, <0 → R (R1 gdy kilka wstecznych). */
export function gearLabel(gear: number | null | undefined, reverseGears = 1): string {
  if (gear === null || gear === undefined || !Number.isFinite(gear)) return "–";
  if (gear > 0) return String(gear);
  if (gear === 0) return "N";
  return reverseGears > 1 ? `R${-gear}` : "R";
}
