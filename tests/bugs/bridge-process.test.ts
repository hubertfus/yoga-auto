/**
 * Błędy bridge'a (S2) znalezione przez S7. Testy, które potrafią zabić proces, odpalają bridge w procesie
 * potomnym (tests/support/bridge-child.ts). Patrz docs/proposals/s7-bug-*.md. Po poprawce: knownBug → it.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { FakePipeServer, testPipePath, type FaultSpec } from "@yoga-auto/fake-pipe";
import { startBridge } from "../../bridge/src/server.ts";
import { PipeSource } from "../../bridge/src/sources/pipe.ts";
import { TestWsClient, sleep } from "../support/ws-client.ts";

const child = resolve(import.meta.dirname, "../support/bridge-child.ts");
const procs: ChildProcess[] = [];
const servers: FakePipeServer[] = [];

afterEach(async () => {
  for (const p of procs.splice(0)) p.kill();
  await Promise.all(servers.splice(0).map((s) => s.stop()));
});

async function spawnBridge(
  target: string,
): Promise<{ proc: ChildProcess; port: number; exited: () => boolean; stderr: () => string }> {
  const proc = spawn(process.execPath, [child, target, "0"], { stdio: ["ignore", "pipe", "pipe"] });
  procs.push(proc);
  let exited = false;
  let err = "";
  proc.on("exit", () => (exited = true));
  proc.stderr!.on("data", (d) => (err += String(d)));
  const port = await new Promise<number>((resolvePort, reject) => {
    const t = setTimeout(() => reject(new Error(`bridge child did not start: ${err}`)), 10_000);
    proc.stdout!.on("data", (d) => {
      const m = /READY (\d+)/.exec(String(d));
      if (m) {
        clearTimeout(t);
        resolvePort(Number(m[1]));
      }
    });
  });
  return { proc, port, exited: () => exited, stderr: () => err };
}

it(
  "WS frame `null` (valid JSON, not an object) must not crash the bridge",
  async () => {
    const b = await spawnBridge("mock");
    const c = await TestWsClient.connect(b.port);
    c.sendRaw("null");
    await sleep(700);
    expect(
      b.exited(),
      `bridge process died: ${
        b
          .stderr()
          .split("\n")
          .find((l) => /TypeError/.test(l)) ?? ""
      }`,
    ).toBe(false);
    c.close();
  },
  20_000,
);

// Uwaga: dziś przeżywa tylko dlatego, że try/catch w PipeSource.onData obejmuje też handlery
// (wyjątek z bridge'a jest raportowany jako „bad frame”) — patrz s7-bug-pipe-nonobject-frame.md.
it("plugin frame `tel` with ch:null does not crash the bridge", async () => {
  const server = new FakePipeServer({
    path: testPipePath("bp"),
    scenario: "highway",
    faults: { garbageRate: 0.5, garbageKinds: ["bad-tel"] } satisfies FaultSpec,
  });
  servers.push(server);
  await server.start();
  const b = await spawnBridge(server.path);
  await sleep(1500);
  expect(
    b.exited(),
    `bridge process died: ${
      b
        .stderr()
        .split("\n")
        .find((l) => /Error/.test(l)) ?? ""
    }`,
  ).toBe(false);
}, 20_000);

it(
  "plugin hello with a different IPC version must be refused (status.connected stays false)",
  async () => {
    const server = new FakePipeServer({ path: testPipePath("bv"), scenario: "highway", faults: { ipcVersion: 2 } });
    servers.push(server);
    await server.start();
    const logs: string[] = [];
    const bridge = await startBridge({
      source: new PipeSource(server.path),
      port: 0,
      host: "127.0.0.1",
      auth: false,
      log: (l, m) => logs.push(`${l} ${m}`),
    });
    try {
      await sleep(800);
      expect(bridge.store.state.status.connected, "bridge accepted ipc v2 as if it were v1").toBe(false);
      expect(logs.some((l) => /^(warn|error) .*ipc/i.test(l))).toBe(true);
    } finally {
      await bridge.close();
    }
  },
);
