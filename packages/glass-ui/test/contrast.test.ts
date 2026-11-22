import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/** Kontrast tekstu na szkle (DESIGN.md §1.4: ≥ 7:1) dla najjaśniejszych punktów trzech tapet testowych (stories/Stage.tsx). */

const css = readFileSync(new URL("../../../shared/design-tokens/generated/tokens.css", import.meta.url), "utf8");

/** Wartość tokenu z pierwszego bloku, w którym występuje (`root` = :root, inaczej selektor zawierający `scope`). */
function token(name: string, scope = ":root"): string {
  const block = css.split("}").find((b) => b.includes(scope));
  const re = new RegExp(`${name}:\\s*([^;]+);`);
  const m = (block ?? "").match(re) ?? css.match(re);
  if (!m) throw new Error(`brak tokenu ${name}`);
  return m[1]!.trim();
}

type RGB = [number, number, number]; // sRGB 0..1 (zakodowane)

function oklchToSrgb(L: number, C: number, hDeg: number): RGB {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin: RGB = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  const enc = (v: number) => {
    const c = Math.min(1, Math.max(0, v));
    return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
  };
  return [enc(lin[0]), enc(lin[1]), enc(lin[2])];
}

function parseOklch(s: string): RGB {
  const m = s.match(/oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)/);
  if (!m) throw new Error(`nie oklch: ${s}`);
  return oklchToSrgb(Number(m[1]) / 100, Number(m[2]), Number(m[3]));
}

const lum = ([r, g, b]: RGB): number => {
  const f = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a: RGB, b: RGB): number => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

/** brightness() mnoży kanały, tint nakłada się z alfą (kompozycja w sRGB, jak w CSS). */
function glassBackdrop(wall: RGB, scope?: string, strong = false): RGB {
  const bright = Number(token("--glass-bright", scope));
  const alpha = parseFloat(token(strong ? "--glass-alpha-strong" : "--glass-alpha", scope)) / 100;
  const tint = parseOklch(token(strong ? "--glass-tint-strong" : "--glass-tint", scope));
  return wall.map((c, i) => alpha * tint[i]! + (1 - alpha) * Math.min(1, c * bright)) as RGB;
}

// najjaśniejsze punkty tapet (po blurze 20 px komórki 64 px nadal przepuszczają jasny kolor)
const WALLPAPERS: Record<string, RGB> = {
  aurora: oklchToSrgb(0.8, 0.17, 95),
  dusk: oklchToSrgb(0.45, 0.12, 260),
  checker: oklchToSrgb(0.85, 0.02, 90),
};

describe("kontrast tekstu na szkle ≥ 7:1 (dark)", () => {
  for (const [name, wall] of Object.entries(WALLPAPERS)) {
    for (const strong of [false, true]) {
      it(`${name} / ${strong ? "strong" : "default"}`, () => {
        const text = parseOklch(token("--text-1"));
        const r = ratio(text, glassBackdrop(wall, undefined, strong));
        expect(r, `kontrast ${r.toFixed(2)}`).toBeGreaterThanOrEqual(7);
      });
    }
  }
});
