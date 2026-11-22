/** Fixture `bridge`: prawdziwy bridge (bez auth) w procesie testu, na MockSource z podsłuchem wejść. Stały port 7423. */
import { test as base } from "@playwright/test";
import { type SourceMsg, type TelemetrySource, type ipc } from "@yoga-auto/protocol";
import { MOCK_SCENARIOS, createMockSource, type MockScenario } from "@yoga-auto/mock";
import { startBridge } from "../bridge/src/server.ts";
import { BRIDGE_PORT } from "./playwright.config.ts";

export interface BridgeCtl {
  /** wejścia, które bridge wysłał do źródła (czyli do „gry”) */
  toSource: ipc.IpcToPlugin[];
  fromSource: SourceMsg[];
  start(opts?: { scenario?: MockScenario; speed?: number }): Promise<void>;
  stop(): Promise<void>;
  restart(): Promise<void>;
}

function makeBridge(): BridgeCtl {
  let running: Awaited<ReturnType<typeof startBridge>> | null = null;
  let last: { scenario?: MockScenario; speed?: number } = {};
  const ctl: BridgeCtl = {
    toSource: [],
    fromSource: [],
    async start(opts = {}) {
      last = opts;
      const inner = createMockSource({ scenario: opts.scenario ?? "highway", speed: opts.speed ?? 1 });
      const source: TelemetrySource = {
        get kind() {
          return inner.kind;
        },
        start: () => inner.start(),
        stop: () => inner.stop(),
        send(m) {
          ctl.toSource.push(m);
          inner.send(m);
        },
        onMessage: (h) =>
          inner.onMessage((m) => {
            ctl.fromSource.push(m);
            h(m);
          }),
      };
      running = await startBridge({ source, port: BRIDGE_PORT, host: "127.0.0.1", auth: false, log: () => {} });
    },
    async stop() {
      const b = running;
      running = null;
      await b?.close();
    },
    async restart() {
      await ctl.stop();
      await ctl.start(last);
    },
  };
  return ctl;
}

export const test = base.extend<{ bridge: BridgeCtl }>({
  bridge: [
    async ({}, use) => {
      const b = makeBridge();
      await b.start();
      await use(b);
      await b.stop();
    },
    { auto: false },
  ],
});
export { expect } from "@playwright/test";
export { MOCK_SCENARIOS };
