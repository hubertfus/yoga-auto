/**
 * Bridge w osobnym procesie (do testów, które mogą go zabić): node tests/support/bridge-child.ts <pipePath|mock> <port>
 * Wypisuje `READY <port>` po starcie. Kod wyjścia ≠ 0 / sygnał = bridge padł.
 */
import { createMockSource } from "@yoga-auto/mock";
import { startBridge } from "../../bridge/src/server.ts";
import { PipeSource } from "../../bridge/src/sources/pipe.ts";

const [target = "mock", port = "0"] = process.argv.slice(2);
const bridge = await startBridge({
  source: target === "mock" ? createMockSource({ scenario: "highway" }) : new PipeSource(target),
  port: Number(port),
  host: "127.0.0.1",
  auth: false,
  log: (l, m) => console.log(`LOG ${l} ${m}`),
});
console.log(`READY ${bridge.port}`);
process.on("SIGTERM", async () => {
  await bridge.close();
  process.exit(0);
});
