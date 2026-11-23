/**
 * Duży zegar ekranu „Jazda” (prędkościomierz / obrotomierz) w stylu zestawu wskaźników ciężarówki:
 * tarcza, łuk postępu, podziałki z cyframi, pola (eko/czerwone), znaczniki (limit, tempomat), wskazówka na sprężynie.
 * Wartość z kanału fast ustawiana imperatywnie (bez re-renderu); odczyt cyfrowy w przerwie łuku u dołu.
 */
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { SpringFollower } from "@yoga-auto/glass-ui";
import type { FastState } from "@yoga-auto/protocol";
import { useFastValue } from "../../core/store.ts";
import { A0, ARC, angleOf, arcPath, polar, scaleTicks } from "./dial.ts";

export interface DialZone {
  from: number;
  to: number;
  tone: "eco" | "warn" | "crit";
}

export interface DialMarker {
  value: number;
  tone: "crit" | "on";
  label: string;
}

export interface DialProps {
  select: (f: FastState) => number;
  min?: number;
  max: number;
  major: number;
  minor: number;
  tickLabel?: (v: number) => string;
  zones?: readonly DialZone[];
  markers?: readonly DialMarker[];
  /** od tej wartości łuk postępu i odczyt na czerwono (np. limit prędkości); null = nigdy */
  overAt?: number | null;
  label: string;
  /** odczyt cyfrowy pod osią wskazówki */
  children?: ReactNode;
  testid?: string;
}

const prefersReducedMotion = (): boolean =>
  typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

const R_TRACK = 92;
const R_ZONE = 86;
const R_TICK = 83;

export function Dial({ select, min = 0, max, major, minor, tickLabel, zones = [], markers = [], overAt = null, label, children, testid }: DialProps) {
  const root = useRef<HTMLDivElement>(null);
  const needle = useRef<SVGGElement>(null);
  const progress = useRef<SVGPathElement>(null);
  const overArc = useRef<SVGPathElement>(null);
  const over = useRef(overAt);
  over.current = overAt;
  const raw = useRef(min);

  const draw = useRef((v: number) => void v);
  draw.current = (v: number) => {
    const a = angleOf(v, min, max);
    const f = ((a - A0) / ARC) * 100;
    needle.current?.setAttribute("transform", `rotate(${a.toFixed(2)} 100 100)`);
    progress.current?.setAttribute("stroke-dasharray", `${f.toFixed(2)} 100`);
    // odcinek ponad progiem (limit) na czerwono: przerwa do progu, kreska do wartości
    const o = over.current;
    const fo = o === null ? f : ((angleOf(o, min, max) - A0) / ARC) * 100;
    overArc.current?.setAttribute("stroke-dasharray", f > fo ? `0 ${fo.toFixed(2)} ${(f - fo).toFixed(2)} 100` : "0 100");
  };
  const follower = useRef<SpringFollower | null>(null);
  useEffect(() => {
    const f = new SpringFollower(raw.current, (x) => draw.current(x), "gauge", () => !prefersReducedMotion());
    f.jump(raw.current);
    follower.current = f;
    return () => f.stop();
  }, [min, max]);

  const setOver = (v: number) => {
    const o = over.current !== null && v > over.current;
    if (root.current && root.current.dataset.over !== String(o)) root.current.dataset.over = String(o);
  };
  useFastValue(select, (v) => {
    raw.current = v;
    follower.current?.set(v);
    setOver(v);
  });
  // zmiana progu (nowy limit) bez zmiany prędkości
  useEffect(() => {
    setOver(raw.current);
    draw.current(follower.current?.value ?? raw.current);
  });

  const ticks = useMemo(() => {
    const out: ReactNode[] = [];
    for (const t of scaleTicks(min, max, major, minor)) {
      const a = angleOf(t.value, min, max);
      const [x0, y0] = polar(a, R_TICK);
      const [x1, y1] = polar(a, t.major ? R_TICK - 11 : R_TICK - 5);
      const hot = zones.some((z) => z.tone === "crit" && t.value >= z.from - 1e-6);
      out.push(<line key={t.value} x1={x0} y1={y0} x2={x1} y2={y1} className="dl-tick" data-major={t.major || undefined} data-hot={hot || undefined} />);
      if (t.major && tickLabel) {
        const [lx, ly] = polar(a, R_TICK - 23);
        out.push(
          <text key={`l${t.value}`} x={lx} y={ly} className="dl-num" data-hot={hot || undefined} textAnchor="middle" dominantBaseline="central">
            {tickLabel(t.value)}
          </text>,
        );
      }
    }
    return out;
  }, [min, max, major, minor, tickLabel, zones]);

  const end = A0 + ARC;
  return (
    <div ref={root} className="dl" role="meter" aria-label={label} aria-valuemin={min} aria-valuemax={max} data-over="false" data-testid={testid}>
      <svg viewBox="0 0 200 200" aria-hidden="true">
        <defs>
          <radialGradient id="dl-face" cx="50%" cy="42%" r="60%">
            <stop offset="0%" className="dl-face-0" />
            <stop offset="100%" className="dl-face-1" />
          </radialGradient>
        </defs>
        <circle cx="100" cy="100" r="99" className="dl-bezel" />
        <circle cx="100" cy="100" r="96" fill="url(#dl-face)" className="dl-face" />
        <path d={arcPath(A0, end, R_TRACK)} className="dl-track" />
        {zones.map((z) => (
          <path key={`${z.tone}${z.from}`} d={arcPath(angleOf(z.from, min, max), angleOf(z.to, min, max), R_ZONE)} className="dl-zone" data-tone={z.tone} />
        ))}
        <path ref={progress} d={arcPath(A0, end, R_TRACK)} className="dl-progress" pathLength={100} strokeDasharray="0 100" />
        <path ref={overArc} d={arcPath(A0, end, R_TRACK)} className="dl-overarc" pathLength={100} strokeDasharray="0 100" />
        {ticks}
        {markers.map((m) => {
          const a = angleOf(m.value, min, max);
          return (
            <g key={m.label} transform={`rotate(${a.toFixed(2)} 100 100)`} className="dl-marker" data-tone={m.tone}>
              <title>{m.label}</title>
              <path d="M 100 13.5 L 95.5 3.5 L 104.5 3.5 Z" />
            </g>
          );
        })}
        <g ref={needle} transform={`rotate(${A0} 100 100)`} className="dl-needle">
          <path d="M 98.9 22 L 101.1 22 L 103.4 112 L 96.6 112 Z" />
        </g>
        <circle cx="100" cy="100" r="10" className="dl-hub" />
        <circle cx="100" cy="100" r="3.5" className="dl-hub-dot" />
      </svg>
      {children ? <div className="dl-readout">{children}</div> : null}
    </div>
  );
}
