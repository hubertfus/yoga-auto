/**
 * Mały zegar półokrągły (paliwo, AdBlue, powietrze, temperatury, akumulator) — wartości z kanału slow (2 Hz),
 * więc zwykły render Reacta. Pola ostrzegawcze na łuku, wskazówka, wartość z jednostką i podpis pod spodem.
 */
import { Icon } from "@yoga-auto/glass-ui";

export interface MiniZone {
  from: number;
  to: number;
  tone: "warn" | "crit" | "eco";
}

export interface MiniGaugeProps {
  icon: string;
  label: string;
  /** wartość w jednostkach skali; null = brak danych */
  value: number | null;
  min: number;
  max: number;
  /** tekst wartości (np. „63%”, „8,2 bar”) */
  text: string;
  /** dopisek pod wartością (np. zasięg) */
  sub?: string;
  /** podpisy końców skali (np. „0”, „1/1”, „C”, „H”) */
  ends?: [string, string];
  zones?: readonly MiniZone[];
  tone?: "warn" | "crit";
  testid?: string;
}

const CX = 60;
const CY = 58;
const R = 46;

function pt(f: number, r: number): [number, number] {
  const a = Math.PI * (1 - f); // f 0 → lewo, 1 → prawo
  return [CX + r * Math.cos(a), CY - r * Math.sin(a)];
}

function arc(f0: number, f1: number, r: number): string {
  const [x0, y0] = pt(f0, r);
  const [x1, y1] = pt(f1, r);
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

export function MiniGauge({ icon, label, value, min, max, text, sub, ends, zones = [], tone, testid }: MiniGaugeProps) {
  const span = max - min || 1;
  const frac = (v: number) => Math.min(1, Math.max(0, (v - min) / span));
  const f = value === null ? null : frac(value);
  const [nx, ny] = pt(f ?? 0, R - 8);
  return (
    <div className="mg" data-tone={tone} data-testid={testid} role="meter" aria-label={label} aria-valuetext={text}>
      <svg viewBox="0 0 120 66" aria-hidden="true">
        <path d={arc(0, 1, R)} className="mg-track" />
        {zones.map((z) => (
          <path key={`${z.tone}${z.from}`} d={arc(frac(z.from), frac(z.to), R)} className="mg-zone" data-tone={z.tone} />
        ))}
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const [x0, y0] = pt(t, R - 5);
          const [x1, y1] = pt(t, R + 5);
          return <line key={t} x1={x0} y1={y0} x2={x1} y2={y1} className="mg-tick" />;
        })}
        {f !== null ? <line x1={CX} y1={CY} x2={nx} y2={ny} className="mg-needle" /> : null}
        <circle cx={CX} cy={CY} r="4" className="mg-hub" />
        {ends ? (
          <>
            <text x={CX - R} y={CY + 7} className="mg-end" textAnchor="middle" dominantBaseline="hanging">
              {ends[0]}
            </text>
            <text x={CX + R} y={CY + 7} className="mg-end" textAnchor="middle" dominantBaseline="hanging">
              {ends[1]}
            </text>
          </>
        ) : null}
      </svg>
      <div className="mg-text">
        <span className="mg-value">{text}</span>
        <span className="mg-label">
          <Icon name={icon} size={14} /> {label}
        </span>
        {sub ? <span className="mg-sub">{sub}</span> : null}
      </div>
    </div>
  );
}
