/**
 * Opcjonalne zależności od narzędzi S7 (`tools/recorder`): ładowane dynamicznie, żeby bridge działał bez nich
 * (zmienna jako specyfikator → bez rozwiązywania w czasie typecheck/build).
 */
import type { TelemetrySource } from "@yoga-auto/protocol";
import type { Recorder } from "./server.ts";

const RECORDER_PKG = "@yoga-auto/recorder";

async function importRecorderPkg(importer: (spec: string) => Promise<unknown> = (s) => import(s)): Promise<Record<string, unknown>> {
  try {
    return (await importer(RECORDER_PKG)) as Record<string, unknown>;
  } catch (e) {
    throw new Error(`${RECORDER_PKG} (tools/recorder, S7) niedostępny: ${String(e)}`);
  }
}

export async function loadRecorder(
  file: string,
  meta: Record<string, unknown>,
  importer?: (spec: string) => Promise<unknown>,
): Promise<Recorder> {
  const mod = await importRecorderPkg(importer);
  const Ctor = mod["YarecRecorder"] as (new (file: string, opts?: Record<string, unknown>) => Recorder) | undefined;
  if (!Ctor) throw new Error(`${RECORDER_PKG} nie eksportuje YarecRecorder`);
  return new Ctor(file, { meta });
}

export async function loadReplaySource(
  opts: { file: string; speed: number; loop: boolean },
  importer?: (spec: string) => Promise<unknown>,
): Promise<TelemetrySource> {
  const mod = await importRecorderPkg(importer);
  const Ctor = mod["ReplaySource"] as (new (o: typeof opts) => TelemetrySource) | undefined;
  if (!Ctor) throw new Error(`${RECORDER_PKG} nie eksportuje ReplaySource`);
  return new Ctor({ ...opts, speed: Number.isFinite(opts.speed) && opts.speed > 0 ? opts.speed : 1 });
}
