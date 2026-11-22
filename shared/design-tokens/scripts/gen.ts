/** tokens.json → generated/tokens.css (custom properties) + generated/tokens.ts */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const pkg = resolve(import.meta.dirname, "..");
const t = JSON.parse(readFileSync(resolve(pkg, "tokens.json"), "utf8"));
const vars = (prefix: string, o: Record<string, string>) =>
  Object.entries(o)
    .map(([k, v]) => `  --${prefix}${k}: ${v};`)
    .join("\n");

const css = `/* AUTO-GENERATED from tokens.json — DO NOT EDIT */
:root {
${vars("", t.color.dark)}
${vars("r-", t.radius)}
${vars("s-", t.space)}
${vars("hit-", t.hit)}
${vars("shadow-", t.shadow)}
${vars("dur-", t.duration)}
${vars("z-", t.z)}
  --font-family: ${t.font.family};
${Object.entries(t.font)
  .filter(([k]) => k !== "family")
  .map(([k, v]) => `  --t-${k}: ${v} var(--font-family);`)
  .join("\n")}
  --dim: 1;
${vars("", t.tier.high)}
}
:root[data-theme="light"] {
${vars("", t.color.light)}
}
:root[data-night="true"] {
  --accent: ${t.color.night.accent};
  --dim: ${t.color.night.dim};
}
${Object.entries(t.tier)
  .map(([k, v]) => `:root[data-tier="${k}"] {\n${vars("", v as Record<string, string>)}\n}`)
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
