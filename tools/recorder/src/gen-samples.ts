/** Regeneruje tools/recorder/samples/*.yarec:  node tools/recorder/src/gen-samples.ts */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { SAMPLES, synthesize } from "./synth.ts";
import { serializeYarec } from "./yarec.ts";

const dir = resolve(import.meta.dirname, "../samples");
mkdirSync(dir, { recursive: true });
for (const s of SAMPLES) {
  const y = await synthesize(s.opts);
  const buf = serializeYarec(y);
  writeFileSync(resolve(dir, s.file), buf);
  console.log(`${s.file}  ${y.entries.length} entries  ${(buf.length / 1024).toFixed(0)} KiB  ${y.durationMs / 1000}s`);
}
