/**
 * yoga-auto bridge — CLI.
 *   node bridge/src/main.ts --source mock --scenario highway --no-auth
 *   node bridge/src/main.ts --source pipe [--record sesja.yarec]
 *   node bridge/src/main.ts --source replay --replay sesja.yarec [--speed 2] [--loop]
 *   node bridge/src/main.ts devices list | revoke <id|nazwa> | revoke --all
 * Konfiguracja: %APPDATA%\yoga-auto\config.json (port, host, fastHz, source, inputEnabled); flagi CLI mają pierwszeństwo.
 */
import { networkInterfaces } from "node:os";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { type TelemetrySource } from "@yoga-auto/protocol";
import { MOCK_SCENARIOS, createMockSource, type MockScenario } from "@yoga-auto/mock";
import { MockMediaProvider } from "@yoga-auto/media";
import { loadConfig, resolveSettings } from "./config.ts";
import { DeviceStore } from "./devices.ts";
import { runDevicesCli } from "./devices-cli.ts";
import { advertise } from "./mdns.ts";
import { dataDir } from "./paths.ts";
import { createMediaModule } from "./modules/media.ts";
import { loadRecorder, loadReplaySource } from "./optional.ts";
import { startBridge } from "./server.ts";
import { PipeSource } from "./sources/pipe.ts";

// ostatnia deska ratunku: nieobsłużone odrzucenie obietnicy nie może ubić procesu w Node 24
process.on("unhandledRejection", (reason) => {
  console.error(`[error] unhandledRejection: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`);
});

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    source: { type: "string" },
    scenario: { type: "string", default: "highway" },
    port: { type: "string" },
    host: { type: "string" },
    "fast-hz": { type: "string" },
    "no-auth": { type: "boolean", default: false },
    "no-mdns": { type: "boolean", default: false },
    "mock-media": { type: "boolean", default: false },
    static: { type: "string" },
    record: { type: "string" },
    replay: { type: "string" },
    speed: { type: "string", default: "1" },
    loop: { type: "boolean", default: false },
  },
});

const dir = dataDir();

if (positionals[0] === "devices") {
  process.exit(runDevicesCli(positionals.slice(1), new DeviceStore(dir)));
}

const { config, warnings } = loadConfig(dir);
for (const w of warnings) console.warn(`[warn] ${w}`);
const settings = resolveSettings(values, config);

let source: TelemetrySource;
if (settings.source === "mock") {
  const scenario = values.scenario as MockScenario;
  if (!MOCK_SCENARIOS.includes(scenario))
    throw new Error(`unknown scenario ${scenario}; use: ${MOCK_SCENARIOS.join(", ")}`);
  source = createMockSource({ scenario });
} else if (settings.source === "pipe") {
  source = new PipeSource();
} else {
  source = await loadReplaySource({ file: settings.replayFile!, speed: Number(values.speed), loop: values.loop });
}
const recorder = values.record ? await loadRecorder(values.record, { source: settings.source }) : undefined;

const staticDir = values.static ?? resolve(import.meta.dirname, "../../apps/yoga/dist");
const modules =
  values["mock-media"] || settings.source === "mock" ? [createMediaModule(new MockMediaProvider())] : [];

const bridge = await startBridge({
  source,
  port: settings.port,
  host: settings.host,
  fastHz: settings.fastHz,
  auth: !values["no-auth"],
  inputEnabled: settings.inputEnabled,
  ...(values["no-auth"] ? {} : { devices: new DeviceStore(dir) }),
  staticDir,
  modules,
  ...(recorder ? { recorder } : {}),
});

const mdns = values["no-mdns"]
  ? null
  : advertise({ port: bridge.port, version: "0.1.0", protocol: "1", log: (l, m) => console.log(`[${l}] ${m}`) });

const ips = Object.values(networkInterfaces())
  .flat()
  .filter((i) => i && i.family === "IPv4" && !i.internal)
  .map((i) => i!.address);
console.log(
  `\n  yoga-auto bridge  ·  source=${settings.source}${settings.source === "mock" ? `/${values.scenario}` : ""}  ·  auth=${!values["no-auth"]}${recorder ? `  ·  record=${recorder.file}` : ""}`,
);
for (const ip of ["localhost", ...ips]) console.log(`  → http://${ip}:${bridge.port}`);
console.log("");

const shutdown = async () => {
  await mdns?.stop();
  await bridge.close(); // zamyka też rekorder (flush + close)
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
