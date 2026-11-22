#!/usr/bin/env node
/**
 * yarec — narzędzia do nagrań sesji.
 *   node tools/recorder/src/cli.ts info  <plik> [--json]
 *   node tools/recorder/src/cli.ts cut   <plik> --from 10 --to 40 [-o out.yarec]     (sekundy)
 *   node tools/recorder/src/cli.ts speed <plik> --factor 2 [-o out.yarec]
 *   node tools/recorder/src/cli.ts gen   --scenario crash --seconds 45 [--seed 1] [-o crash.yarec]
 */
import { statSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { MOCK_SCENARIOS, type MockScenario } from "@yoga-auto/mock";
import { synthesize } from "./synth.ts";
import { cutYarec, infoYarec, readYarec, serializeYarec, speedYarec } from "./yarec.ts";

const [cmd, ...rest] = process.argv.slice(2);
const { values, positionals } = parseArgs({
  args: rest,
  allowPositionals: true,
  options: {
    from: { type: "string", default: "0" },
    to: { type: "string" },
    factor: { type: "string" },
    out: { type: "string", short: "o" },
    json: { type: "boolean", default: false },
    scenario: { type: "string", default: "highway" },
    seconds: { type: "string", default: "60" },
    seed: { type: "string" },
    fps: { type: "string" },
  },
});

const usage = () => {
  console.error("usage: yarec info|cut|speed|gen  (zob. nagłówek tools/recorder/src/cli.ts)");
  process.exit(2);
};

const fmt = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

switch (cmd) {
  case "info": {
    const file = positionals[0] ?? usage();
    const info = { ...infoYarec(readYarec(file)), file, bytes: statSync(file).size };
    if (values.json) console.log(JSON.stringify(info, null, 2));
    else {
      console.log(`${file}  ${(info.bytes / 1024).toFixed(0)} KiB${info.truncated ? "  (UCIĘTY)" : ""}`);
      console.log(
        `  gra:       ${info.game ?? "?"}   źródło: ${String(info.meta?.source ?? "?")}   start: ${info.meta?.startedAt ?? "?"}`,
      );
      console.log(`  czas:      ${fmt(info.durationMs)}   wpisów: ${info.entries} ${JSON.stringify(info.byKind)}`);
      console.log(
        `  tel:       ${info.telFrames} ramek${info.telHz ? ` (~${info.telHz} Hz)` : ""}, ${info.channels} kanałów`,
      );
      console.log(`  ipc:       ${JSON.stringify(info.ipc)}`);
      if (Object.keys(info.ws).length) console.log(`  ws:        ${JSON.stringify(info.ws)}`);
      for (const e of info.events) console.log(`  zdarzenie: ${fmt(e.ts).padStart(8)}  ${e.id}`);
      for (const g of info.gaps) console.log(`  przerwa:   ${fmt(g.atMs).padStart(8)}  ${fmt(g.lenMs)} bez tel`);
    }
    break;
  }
  case "cut": {
    const file = positionals[0] ?? usage();
    const y = cutYarec(readYarec(file), Number(values.from) * 1000, values.to ? Number(values.to) * 1000 : Infinity);
    const out = values.out ?? file.replace(/\.yarec$/, "") + ".cut.yarec";
    writeFileSync(out, serializeYarec(y));
    console.log(`${out}  ${y.entries.length} wpisów, ${fmt(y.durationMs)}`);
    break;
  }
  case "speed": {
    const file = positionals[0] ?? usage();
    if (!values.factor) usage();
    const y = speedYarec(readYarec(file), Number(values.factor));
    const out = values.out ?? file.replace(/\.yarec$/, "") + `.x${values.factor}.yarec`;
    writeFileSync(out, serializeYarec(y));
    console.log(`${out}  ${y.entries.length} wpisów, ${fmt(y.durationMs)}`);
    break;
  }
  case "gen": {
    const scenario = values.scenario as MockScenario;
    if (!MOCK_SCENARIOS.includes(scenario)) {
      console.error(`scenario: ${MOCK_SCENARIOS.join(" | ")}`);
      process.exit(2);
    }
    const y = await synthesize({
      scenario,
      seconds: Number(values.seconds),
      ...(values.seed ? { seed: Number(values.seed) } : {}),
      ...(values.fps ? { fps: Number(values.fps) } : {}),
    });
    const out = values.out ?? `${scenario}-${values.seconds}s.yarec`;
    writeFileSync(out, serializeYarec(y));
    console.log(`${out}  ${y.entries.length} wpisów, ${fmt(y.durationMs)}`);
    break;
  }
  default:
    usage();
}
