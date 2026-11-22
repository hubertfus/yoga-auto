/**
 * tokens.json → generated/tokens.css (custom properties) + generated/tokens.ts
 *
 * Poza prostym mapowaniem generator liczy:
 *  - tryb nocny: jasność (L w OKLCH) tekstu, akcentów i tintu szkła × `night.dim`, akcent na ciepłym hue,
 *  - krzywe springów jako CSS `linear()` (`--ease-<spring>` + `--dur-<spring>`), żeby proste przejścia
 *    (toggle, segmented, dock) miały fizyczny ruch bez JS. Czas trwania ≤ 450 ms (DESIGN.md §1.6).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const pkg = resolve(import.meta.dirname, "..");
const t = JSON.parse(readFileSync(resolve(pkg, "tokens.json"), "utf8"));
type Dict = Record<string, string>;
const vars = (prefix: string, o: Dict) =>
  Object.entries(o)
    .map(([k, v]) => `  --${prefix}${k}: ${v};`)
    .join("\n");

/** "oklch(98% 0 0)" → L przemnożone przez f. Inne formaty bez zmian. */
function dimOklch(value: string, f: number): string {
  const m = /^oklch\(\s*([\d.]+)%\s+(.*)\)$/.exec(value.trim());
  if (!m) return value;
  const l = Math.round(Number(m[1]) * f * 10) / 10;
  return `oklch(${l}% ${m[2]})`;
}

const dim = Number(t.color.night.dim);
const DIMMED = ["text-1", "text-2", "text-3", "on", "lights", "beam-high", "warn", "crit"];
const nightVars: Dict = {};
for (const k of DIMMED) nightVars[k] = dimOklch(t.color.dark[k], dim);
nightVars["accent"] = dimOklch(t.color.night.accent, Math.max(dim, 0.85));
// Szkło w nocy ciemniejsze, żeby przyciemniony tekst dalej miał ≥ 7:1.
nightVars["glass-tint"] = dimOklch(t.color.dark["glass-tint"], dim);
nightVars["glass-tint-strong"] = dimOklch(t.color.dark["glass-tint-strong"], dim);
nightVars["bg-0"] = dimOklch(t.color.dark["bg-0"], dim);
nightVars["dim"] = t.color.night.dim;
Object.assign(nightVars, t.material.night ?? {});

interface Spring {
  stiffness: number;
  damping: number;
  mass: number;
}
const MAX_MS = 450;

/** Symulacja sprężyny 0 → 1; zwraca punkty `linear()` i czas do ustalenia (|x−1| < 0.5%). */
function springCurve(s: Spring): { points: number[]; ms: number } {
  const dt = 1 / 1000;
  let x = 0;
  let v = 0;
  const xs: number[] = [];
  let settled = -1;
  for (let i = 0; i < 2000; i++) {
    const a = (-s.stiffness * (x - 1) - s.damping * v) / s.mass;
    v += a * dt;
    x += v * dt;
    xs.push(x);
    if (Math.abs(x - 1) < 0.005 && Math.abs(v) < 0.05) {
      if (settled < 0) settled = i;
    } else settled = -1;
    if (settled >= 0 && i - settled > 30) break;
  }
  // Dłuższe sprężyny są kompresowane w czasie do MAX_MS (zamiast obcięcia, które dałoby skok na końcu).
  const total = settled < 0 ? xs.length : settled + 1;
  const N = 32;
  const points: number[] = [];
  for (let i = 0; i <= N; i++) {
    const idx = Math.min(total - 1, Math.round((i / N) * (total - 1)));
    points.push(i === N ? 1 : Math.round((xs[idx] ?? 1) * 1000) / 1000);
  }
  points[0] = 0;
  return { points, ms: Math.min(total, MAX_MS) };
}

const springVars = Object.entries(t.spring as Record<string, Spring>)
  .map(([k, s]) => {
    const c = springCurve(s);
    return `  --ease-${k}: linear(${c.points.join(", ")});\n  --dur-${k}: ${c.ms}ms;`;
  })
  .join("\n");

const css = `/* AUTO-GENERATED from tokens.json — DO NOT EDIT */
:root {
${vars("", t.color.dark)}
${vars("", t.material.dark)}
${vars("r-", t.radius)}
${vars("s-", t.space)}
${vars("hit-", t.hit)}
${vars("shadow-", t.shadow)}
${vars("dur-", t.duration)}
${vars("z-", t.z)}
${springVars}
  --font-family: ${t.font.family};
${Object.entries(t.font as Dict)
  .filter(([k]) => k !== "family")
  .map(([k, v]) => `  --t-${k}: ${v} var(--font-family);`)
  .join("\n")}
  --dim: 1;
${vars("", t.tier.high)}
  color-scheme: dark;
}
:root[data-theme="light"] {
${vars("", t.color.light)}
${vars("", t.material.light)}
  color-scheme: light;
}
:root[data-night="true"] {
${vars("", nightVars)}
  color-scheme: dark;
}
${Object.entries(t.tier)
  .map(([k, v]) => `:root[data-tier="${k}"] {\n${vars("", v as Dict)}\n}`)
  .join("\n")}
`;
writeFileSync(resolve(pkg, "generated/tokens.css"), css);

const ts = `// AUTO-GENERATED from tokens.json — DO NOT EDIT
export const tokens = ${JSON.stringify(t, null, 2)} as const;
export type PerfTier = keyof typeof tokens.tier;
export const PERF_TIERS = ["ultra", "high", "lite", "flat"] as const satisfies readonly PerfTier[];
export type SpringName = keyof typeof tokens.spring;
export const springs = tokens.spring;
`;
writeFileSync(resolve(pkg, "generated/tokens.ts"), ts);
console.log("gen: design-tokens");
