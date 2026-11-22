/**
 * yoga-auto bridge — CLI.
 *   node bridge/src/main.ts --source mock --scenario highway --no-auth
 *   node bridge/src/main.ts --source pipe
 */
import { networkInterfaces } from "node:os";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { DEFAULT_PORT, type TelemetrySource } from "@yoga-auto/protocol";
import { MOCK_SCENARIOS, createMockSource, type MockScenario } from "@yoga-auto/mock";
import { MockMediaProvider } from "@yoga-auto/media";
import { createMediaModule } from "./modules/media.ts";
import { startBridge } from "./server.ts";
import { PipeSource } from "./sources/pipe.ts";

const { values } = parseArgs({
  options: {
    source: { type: "string", default: "pipe" },
    scenario: { type: "string", default: "highway" },
    port: { type: "string", default: String(DEFAULT_PORT) },
    host: { type: "string", default: "0.0.0.0" },
    "fast-hz": { type: "string", default: "30" },
    "no-auth": { type: "boolean", default: false },
    "mock-media": { type: "boolean", default: false },
    static: { type: "string" },
  },
});

let source: TelemetrySource;
if (values.source === "mock") {
  const scenario = values.scenario as MockScenario;
  if (!MOCK_SCENARIOS.includes(scenario))
    throw new Error(`unknown scenario ${scenario}; use: ${MOCK_SCENARIOS.join(", ")}`);
  source = createMockSource({ scenario });
} else if (values.source === "pipe") {
  source = new PipeSource();
} else {
  throw new Error(`unknown --source ${values.source} (mock | pipe)`);
}

const staticDir = values.static ?? resolve(import.meta.dirname, "../../apps/yoga/dist");
const modules = values["mock-media"] || values.source === "mock" ? [createMediaModule(new MockMediaProvider())] : [];

const bridge = await startBridge({
  source,
  port: Number(values.port),
  host: values.host,
  fastHz: Number(values["fast-hz"]),
  auth: !values["no-auth"],
  tokens: new Set(),
  staticDir,
  modules,
});

const ips = Object.values(networkInterfaces())
  .flat()
  .filter((i) => i && i.family === "IPv4" && !i.internal)
  .map((i) => i!.address);
console.log(
  `\n  yoga-auto bridge  ·  source=${values.source}${values.source === "mock" ? `/${values.scenario}` : ""}  ·  auth=${!values["no-auth"]}`,
);
for (const ip of ["localhost", ...ips]) console.log(`  → http://${ip}:${bridge.port}`);
console.log("");

const shutdown = async () => {
  await bridge.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
