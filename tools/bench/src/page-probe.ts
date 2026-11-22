/**
 * Sonda uruchamiana W STRONIE: mierzy odstępy między klatkami (rAF) przez `ms` milisekund i zwraca tablicę delt.
 * Jako string, żeby ta sama sonda działała w Playwright (page.evaluate) i ręcznie na Yodze
 * (`node tools/bench/src/cli.ts snippet` drukuje gotowy kawałek do wklejenia w konsolę).
 */
export const PROBE_SOURCE = `(ms) => new Promise((resolve) => {
  const deltas = [];
  let last = performance.now();
  const t0 = last;
  const tick = (now) => {
    deltas.push(now - last);
    last = now;
    if (now - t0 < ms) requestAnimationFrame(tick);
    else resolve({ deltas, tier: document.documentElement.dataset.tier ?? null, ua: navigator.userAgent, dpr: devicePixelRatio, size: [innerWidth, innerHeight] });
  };
  requestAnimationFrame(tick);
})`;

export interface ProbeResult {
  deltas: number[];
  tier: string | null;
  ua: string;
  dpr: number;
  size: [number, number];
}

/** Do wklejenia w konsolę przeglądarki na Yodze (tryb ręczny): zwraca JSON do skopiowania. */
export function manualSnippet(seconds = 10): string {
  return `(${PROBE_SOURCE})(${seconds * 1000}).then((r) => { const s = r.deltas.slice(1).sort((a, b) => a - b); const p = (q) => s[Math.min(s.length - 1, Math.ceil(q / 100 * s.length) - 1)]; const out = { tier: r.tier, frames: s.length, fps: +(s.length / (s.reduce((a, b) => a + b, 0) / 1000)).toFixed(1), p50: +p(50).toFixed(2), p95: +p(95).toFixed(2), p99: +p(99).toFixed(2), dropped: s.filter((d) => d > 25).length, ua: r.ua }; console.log(JSON.stringify(out)); copy(JSON.stringify(out)); return out; })`;
}
