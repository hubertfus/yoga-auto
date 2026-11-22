/**
 * Generator syntetycznych nagrań: uruchamia MockSource w trybie `manual` na czasie wirtualnym,
 * więc wynik jest deterministyczny (ten sam seed = ten sam plik, bajt w bajt po dekompresji).
 */
import type { SourceMsg } from "@yoga-auto/protocol";
import { MockSource, type MockScenario } from "@yoga-auto/mock";
import { makeMeta, type Yarec, type YarecEntry } from "./yarec.ts";

export interface SynthOptions {
  scenario: MockScenario;
  seconds: number;
  fps?: number;
  seed?: number;
  /** stały znacznik czasu w meta (deterministyczny plik); domyślnie 2026-01-01T00:00:00Z */
  startedAt?: string;
}

export async function synthesize(opts: SynthOptions): Promise<Yarec> {
  const fps = opts.fps ?? 30;
  const mock = new MockSource({ scenario: opts.scenario, fps, seed: opts.seed ?? 42, manual: true });
  const entries: YarecEntry[] = [];
  let ts = 0;
  mock.onMessage((m: SourceMsg) => {
    entries.push({ ts: Math.round(ts * 10) / 10, kind: "ipc", msg: m });
  });
  await mock.start();
  const frames = Math.round(opts.seconds * fps);
  for (let i = 0; i < frames; i++) {
    ts = ((i + 1) * 1000) / fps;
    mock.advance();
  }
  const durationMs = entries.at(-1)?.ts ?? 0;
  return {
    meta: makeMeta({
      source: "synthetic",
      startedAt: opts.startedAt ?? "2026-01-01T00:00:00.000Z",
      note: `mock ${opts.scenario}, ${opts.seconds}s @ ${fps} fps, seed ${opts.seed ?? 42}`,
      scenario: opts.scenario,
    }),
    entries,
    durationMs,
    truncated: false,
  };
}

/** Zestaw próbek dostarczanych w repo (`tools/recorder/samples/`). */
export const SAMPLES: readonly { file: string; opts: SynthOptions }[] = [
  { file: "highway-60s.yarec", opts: { scenario: "highway", seconds: 60 } },
  { file: "city-night-60s.yarec", opts: { scenario: "city-night", seconds: 60 } },
  { file: "job-cycle-90s.yarec", opts: { scenario: "job-cycle", seconds: 90 } },
];
