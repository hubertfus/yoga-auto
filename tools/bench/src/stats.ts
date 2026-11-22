/** Statystyki klatek i percentyle (czyste funkcje, testowane w stats.test.ts). */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx]!;
}

export interface Summary {
  n: number;
  mean: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

const r2 = (x: number) => Math.round(x * 100) / 100;

export function summarize(values: readonly number[]): Summary {
  const s = [...values].sort((a, b) => a - b);
  const mean = s.length ? s.reduce((a, b) => a + b, 0) / s.length : NaN;
  return {
    n: s.length,
    mean: r2(mean),
    p50: r2(percentile(s, 50)),
    p95: r2(percentile(s, 95)),
    p99: r2(percentile(s, 99)),
    max: r2(s.length ? s[s.length - 1]! : NaN),
  };
}

export interface FrameReport {
  frames: number;
  durationMs: number;
  fps: number;
  /** czasy klatek (odstęp między rAF), ms */
  frameMs: Summary;
  /** klatki dłuższe niż 1.5 × okres odświeżania (zgubione) */
  dropped: number;
  droppedPct: number;
  /** klatki > 50 ms (wyraźny zgrzyt) */
  jank: number;
}

/** `deltas` = odstępy między kolejnymi rAF w ms; `refreshMs` = okres odświeżania (16.67 przy 60 Hz). */
export function analyzeFrames(deltas: readonly number[], refreshMs = 1000 / 60): FrameReport {
  const dur = deltas.reduce((a, b) => a + b, 0);
  const dropped = deltas.filter((d) => d > refreshMs * 1.5).length;
  return {
    frames: deltas.length,
    durationMs: r2(dur),
    fps: dur > 0 ? r2((deltas.length / dur) * 1000) : 0,
    frameMs: summarize(deltas),
    dropped,
    droppedPct: deltas.length ? r2((dropped / deltas.length) * 100) : 0,
    jank: deltas.filter((d) => d > 50).length,
  };
}
