import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, type ReactNode } from "react";
import type { SpringName } from "@yoga-auto/design-tokens";
import { IconGlyph } from "./icons/index.tsx";
import { SpringFollower } from "./spring.ts";

export { registerIcon, ICON_NAMES } from "./icons/index.tsx";
export type { IconName, VehicleIconName } from "./icons/index.tsx";

/** Imperatywne API: wartość ustawiana bez re-renderu (szybki kanał telemetrii). */
export interface ValueHandle {
  setValue(value: number): void;
}

const prefersReducedMotion = (): boolean =>
  typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export interface NumericProps {
  format?: (v: number) => string;
  initial?: number;
  className?: string;
  /** wygładzanie sprężyną (np. `gauge`); domyślnie brak — cyfry mają być dokładne */
  spring?: SpringName;
}

/** Liczba tabular-nums aktualizowana przez `ref.setValue(n)` bez re-renderu (zapis tylko przy zmianie tekstu). */
export const Numeric = forwardRef<ValueHandle, NumericProps>(function Numeric(
  { format = (v) => String(Math.round(v)), initial = 0, className, spring },
  ref,
) {
  const el = useRef<HTMLSpanElement>(null);
  const last = useRef("");
  const fmt = useRef(format);
  fmt.current = format;
  const follower = useRef<SpringFollower | null>(null);

  const write = (v: number) => {
    const s = fmt.current(v);
    if (s !== last.current && el.current) {
      el.current.textContent = s;
      last.current = s;
    }
  };

  useEffect(() => {
    if (!spring) {
      follower.current = null;
      return;
    }
    const f = new SpringFollower(follower.current?.value ?? initial, write, spring, () => !prefersReducedMotion());
    follower.current = f;
    return () => f.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spring]);

  useImperativeHandle(
    ref,
    () => ({
      setValue(v) {
        if (follower.current) follower.current.set(v);
        else write(v);
      },
    }),
    [],
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
  /** liczba głównych podziałek (odstępów) */
  ticks?: number;
  /** podziałek pośrednich między głównymi */
  minorTicks?: number;
  /** wartość, od której zaczyna się strefa czerwona */
  redline?: number;
  size?: number;
  label?: string;
  initial?: number;
  /** podpisy głównych podziałek (np. v => String(v / 100)) */
  tickLabel?: (value: number) => string;
  /** sprężyna wskazówki (tokeny); `false` = bez wygładzania */
  spring?: SpringName | false;
  /** zawartość środka (np. `<Numeric>` + jednostka) */
  children?: ReactNode;
  className?: string;
}

const CX = 50;
const CY = 50;
const R = 40;
const rad = (deg: number) => (deg * Math.PI) / 180;
const polar = (deg: number, r = R) => ({ x: CX + r * Math.sin(rad(deg)), y: CY - r * Math.cos(rad(deg)) });

/** Łuk SVG od kąta a0 do a1 (stopnie od godziny 12, zgodnie z ruchem wskazówek). */
function arcPath(a0: number, a1: number, r = R): string {
  const p0 = polar(a0, r);
  const p1 = polar(a1, r);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M ${p0.x.toFixed(3)} ${p0.y.toFixed(3)} A ${r} ${r} 0 ${large} 1 ${p1.x.toFixed(3)} ${p1.y.toFixed(3)}`;
}

/**
 * Zegar łukowy (SVG): wartość przez `ref.setValue()` bez re-renderu; wskazówka i łuk postępu goni cel sprężyną
 * `gauge` (DESIGN.md §3.2). Strefa redline na łuku i zmiana koloru postępu po jej przekroczeniu.
 */
export const Gauge = forwardRef<ValueHandle, GaugeProps>(function Gauge(
  {
    min,
    max,
    arc = 240,
    ticks = 10,
    minorTicks = 0,
    redline,
    size = 320,
    label,
    initial,
    tickLabel,
    spring = "gauge",
    children,
    className,
  },
  ref,
) {
  const needle = useRef<SVGGElement>(null);
  const progress = useRef<SVGPathElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const span = max - min || 1;
  const a0 = -arc / 2;
  const toAngle = (v: number) => a0 + (Math.max(min, Math.min(max, v)) - min) / span * arc;
  const redlineAt = redline;
  const ariaTick = useRef(0);

  const draw = useRef((v: number) => {
    void v;
  });
  draw.current = (v: number) => {
    const f = Math.max(0, Math.min(1, (v - min) / span));
    needle.current?.setAttribute("transform", `rotate(${(a0 + f * arc).toFixed(2)} ${CX} ${CY})`);
    const p = progress.current;
    if (p) {
      p.setAttribute("stroke-dasharray", `${(f * 100).toFixed(2)} 100`);
      p.setAttribute("data-over", redlineAt !== undefined && v >= redlineAt ? "true" : "false");
    }
    const now = performance.now();
    if (root.current && now - ariaTick.current > 500) {
      ariaTick.current = now;
      root.current.setAttribute("aria-valuenow", String(Math.round(v)));
    }
  };

  const follower = useRef<SpringFollower | null>(null);
  useEffect(() => {
    const start = follower.current?.value ?? initial ?? min;
    const f = new SpringFollower(start, (x) => draw.current(x), spring === false ? "gauge" : spring, () => spring !== false && !prefersReducedMotion());
    follower.current = f;
    f.jump(start);
    return () => f.stop();
  }, [spring, min, max, arc, initial]);

  useImperativeHandle(ref, () => ({ setValue: (v) => follower.current?.set(v) }), []);

  const ticksEls = useMemo(() => {
    const out: ReactNode[] = [];
    const total = ticks * (minorTicks + 1);
    for (let i = 0; i <= total; i++) {
      const major = i % (minorTicks + 1) === 0;
      const a = a0 + (i / total) * arc;
      const p0 = polar(a, major ? R - 9 : R - 6);
      const p1 = polar(a, R - 3.5);
      const value = min + (i / total) * span;
      const hot = redlineAt !== undefined && value >= redlineAt;
      out.push(
        <line
          key={i}
          x1={p0.x}
          y1={p0.y}
          x2={p1.x}
          y2={p1.y}
          className={major ? "lg-gauge__tick lg-gauge__tick--major" : "lg-gauge__tick"}
          data-hot={hot || undefined}
        />,
      );
      if (major && tickLabel) {
        const pl = polar(a, R - 15);
        out.push(
          <text key={`l${i}`} x={pl.x} y={pl.y} className="lg-gauge__label" textAnchor="middle" dominantBaseline="central">
            {tickLabel(value)}
          </text>,
        );
      }
    }
    return out;
  }, [a0, arc, min, span, ticks, minorTicks, redlineAt, tickLabel]);

  const aEnd = a0 + arc;
  return (
    <div
      ref={root}
      className={`lg-gauge ${className ?? ""}`}
      style={{ width: size, height: size }}
      role="meter"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={initial ?? min}
    >
      <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden>
        <path d={arcPath(a0, aEnd)} className="lg-gauge__track" pathLength={100} />
        {redlineAt !== undefined ? <path d={arcPath(toAngle(redlineAt), aEnd)} className="lg-gauge__redline" /> : null}
        <path d={arcPath(a0, aEnd)} className="lg-gauge__progress" ref={progress} pathLength={100} strokeDasharray="0 100" />
        {ticksEls}
        <g ref={needle} transform={`rotate(${a0} ${CX} ${CY})`} className="lg-gauge__needle">
          <line x1={CX} y1={CY - 6} x2={CX} y2={CY - R + 12} />
          <circle cx={CX} cy={CY} r="2.6" />
        </g>
      </svg>
      {children ? <div className="lg-gauge__center">{children}</div> : null}
    </div>
  );
});

export interface IconProps {
  name: string;
  size?: number;
  title?: string;
  strokeWidth?: number;
  className?: string;
}

/** Ikona: Lucide (ogólne) + własne ikony kontrolek pojazdu (`lights-low`, `retarder`, `diff-lock`…). */
export function Icon({ name, size = 28, title, strokeWidth = 2, className }: IconProps) {
  return (
    <span
      className={`lg-icon ${className ?? ""}`}
      style={{ width: size, height: size }}
      {...(title ? { role: "img", "aria-label": title, title } : { "aria-hidden": true })}
    >
      <IconGlyph name={name} size={size} strokeWidth={strokeWidth} />
    </span>
  );
}
