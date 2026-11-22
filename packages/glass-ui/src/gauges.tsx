import { forwardRef, useImperativeHandle, useRef } from "react";

/** Imperatywne API: wartość ustawiana bez re-renderu (szybki kanał telemetrii). */
export interface ValueHandle {
  setValue(value: number): void;
}

export interface NumericProps {
  format?: (v: number) => string;
  initial?: number;
  className?: string;
}

export const Numeric = forwardRef<ValueHandle, NumericProps>(function Numeric(
  { format = (v) => String(Math.round(v)), initial = 0, className },
  ref,
) {
  const el = useRef<HTMLSpanElement>(null);
  const last = useRef("");
  useImperativeHandle(
    ref,
    () => ({
      setValue(v) {
        const s = format(v);
        if (s !== last.current && el.current) {
          el.current.textContent = s;
          last.current = s;
        }
      },
    }),
    [format],
  );
  return (
    <span ref={el} className={`lg-numeric ${className ?? ""}`}>
      {format(initial)}
    </span>
  );
});

export interface GaugeProps {
  min: number;
  max: number;
  /** stopnie łuku */
  arc?: number;
  ticks?: number;
  redline?: number;
  size?: number;
  label?: string;
}

/** F0: prosta wskazówka bez springa. S3: spring gauge, redline, łuk postępu. */
export const Gauge = forwardRef<ValueHandle, GaugeProps>(function Gauge(
  { min, max, arc = 240, ticks = 10, size = 320, label },
  ref,
) {
  const needle = useRef<SVGLineElement>(null);
  useImperativeHandle(
    ref,
    () => ({
      setValue(v) {
        const f = Math.max(0, Math.min(1, (v - min) / (max - min || 1)));
        needle.current?.setAttribute("transform", `rotate(${-arc / 2 + f * arc} 50 50)`);
      },
    }),
    [min, max, arc],
  );
  return (
    <svg className="lg-gauge" viewBox="0 0 100 100" width={size} height={size} aria-label={label}>
      {Array.from({ length: ticks + 1 }, (_, i) => (
        <line
          key={i}
          x1="50"
          y1="6"
          x2="50"
          y2="11"
          transform={`rotate(${-arc / 2 + (i / ticks) * arc} 50 50)`}
          stroke="var(--text-2)"
          strokeWidth="1"
        />
      ))}
      <line
        ref={needle}
        x1="50"
        y1="50"
        x2="50"
        y2="12"
        stroke="var(--accent)"
        strokeWidth="2"
        strokeLinecap="round"
        transform={`rotate(${-arc / 2} 50 50)`}
      />
    </svg>
  );
});

export interface IconProps {
  name: string;
  size?: number;
  title?: string;
}

/** F0: placeholder (pierwsza litera). S3: Lucide/Phosphor + własne ikony kontrolek pojazdu. */
export function Icon({ name, size = 28, title }: IconProps) {
  return (
    <span
      className="lg-icon"
      style={{ width: size, height: size, fontSize: size * 0.6 }}
      title={title ?? name}
      aria-hidden={!title}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}
