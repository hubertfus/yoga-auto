/** Strzałka manewru (SVG generowane z kąta skrętu), w stylu nawigacji samochodowej. */
import { Icon } from "@yoga-auto/glass-ui";
import type { ManeuverKind } from "@yoga-auto/protocol";

const KIND_ANGLE: Partial<Record<ManeuverKind, number>> = {
  straight: 0,
  keepLeft: -30,
  keepRight: 30,
  slightLeft: -45,
  slightRight: 45,
  left: -90,
  right: 90,
  sharpLeft: -135,
  sharpRight: 135,
};

function arrowHead(x: number, y: number, deg: number, size = 4.2): string {
  const r = (deg * Math.PI) / 180;
  // kierunek grotu: (sin, −cos); skrzydła ±140°
  const wing = (d: number) => {
    const a = r + (d * Math.PI) / 180;
    return `${(x + Math.sin(a) * size).toFixed(2)} ${(y - Math.cos(a) * size).toFixed(2)}`;
  };
  return `M ${wing(-140)} L ${x.toFixed(2)} ${y.toFixed(2)} L ${wing(140)}`;
}

export function ManeuverIcon({ kind, size = 48, angle }: { kind: ManeuverKind; size?: number; angle?: number }) {
  if (kind === "arrive") return <Icon name="flag" size={size} />;
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    "data-kind": kind,
  };
  if (kind === "ferry")
    return (
      <svg {...common} strokeWidth={2.2}>
        <path d="M2 20c2 1.2 4 1.2 6 0s4-1.2 6 0 4 1.2 6 0" />
        <path d="M4.5 16.5 5.5 11h13l1 5.5" />
        <path d="M12 11V4h4" />
      </svg>
    );
  if (kind === "uturn") {
    // ruch prawostronny: zawracanie zwykle w lewo; w prawo = lustrzane odbicie
    const left = (angle ?? -180) <= 0;
    return (
      <svg {...common}>
        <g transform={left ? undefined : "matrix(-1 0 0 1 24 0)"}>
          <path d="M 15.5 21 V 10 A 3.5 3.5 0 0 0 8.5 10 V 16.5" />
          <path d={arrowHead(8.5, 17, 180)} />
        </g>
      </svg>
    );
  }
  const deg = KIND_ANGLE[kind] ?? 0;
  const r = (deg * Math.PI) / 180;
  const jy = 12;
  const ex = deg === 0 ? 12 : 12 + Math.sin(r) * 8;
  const ey = deg === 0 ? 3 : jy - Math.cos(r) * 8;
  const fork = kind === "keepLeft" || kind === "keepRight";
  return (
    <svg {...common}>
      {fork ? <path d={`M 12 12 L ${(24 - ex).toFixed(2)} ${ey.toFixed(2)}`} opacity={0.35} /> : null}
      <path d={deg === 0 ? "M 12 21 V 3" : `M 12 21 V ${jy} L ${ex.toFixed(2)} ${ey.toFixed(2)}`} />
      <path d={arrowHead(ex, ey, deg)} />
    </svg>
  );
}
