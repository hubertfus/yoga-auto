/** config.json + CLI, subkomenda devices, mDNS, ładowanie opcjonalnego rekordera, proces main.ts. */
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WS_SUBPROTOCOL } from "@yoga-auto/protocol";
import { WebSocket } from "ws";
import { loadConfig, resolveSettings } from "../src/config.ts";
import { DeviceStore } from "../src/devices.ts";
import { runDevicesCli } from "../src/devices-cli.ts";
import { advertise, type BonjourLike } from "../src/mdns.ts";
import { loadRecorder, loadReplaySource } from "../src/optional.ts";
import { startBridge } from "../src/server.ts";
import { createMockSource } from "@yoga-auto/mock";
import { TestClient } from "./ws-client.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "yoga-bridge-cli-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("config.json", () => {
  it("brak pliku → {}", () => expect(loadConfig(dir)).toEqual({ config: {}, warnings: [] }));

  it("poprawny plik", () => {
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({ port: 7500, host: "127.0.0.1", fastHz: 60, source: "replay:a.yarec", inputEnabled: false }),
    );
    const { config, warnings } = loadConfig(dir);
    expect(warnings).toEqual([]);
    expect(config).toEqual({ port: 7500, host: "127.0.0.1", fastHz: 60, source: "replay:a.yarec", inputEnabled: false });
  });

  it("zły JSON / złe pola → domyślne + ostrzeżenia, bez wyjątku", () => {
    writeFileSync(join(dir, "config.json"), "{oops");
    expect(loadConfig(dir).warnings).toHaveLength(1);
    writeFileSync(join(dir, "config.json"), JSON.stringify({ port: "x", fastHz: 45, source: "tv", inputEnabled: 1, host: "" }));
    const r = loadConfig(dir);
    expect(r.config).toEqual({});
    expect(r.warnings).toHaveLength(5);
    writeFileSync(join(dir, "config.json"), "[1]");
    expect(loadConfig(dir).warnings).toHaveLength(1);
  });

  it("pierwszeństwo: CLI > config > domyślne", () => {
    expect(resolveSettings({}, {})).toMatchObject({ source: "pipe", port: 7420, fastHz: 30, inputEnabled: true });
    expect(resolveSettings({}, { port: 7500, fastHz: 60, source: "mock", inputEnabled: false })).toMatchObject({
      source: "mock",
      port: 7500,
      fastHz: 60,
      inputEnabled: false,
    });
    expect(resolveSettings({ port: "7421", source: "pipe", "fast-hz": "15" }, { port: 7500, source: "mock" })).toMatchObject({
      source: "pipe",
      port: 7421,
      fastHz: 15,
    });
  });

  it("źródło replay: plik z --replay albo z replay:<plik>; błędy flag", () => {
    expect(resolveSettings({ source: "replay", replay: "a.yarec" }, {}).replayFile).toBe("a.yarec");
    expect(resolveSettings({ source: "replay:b.yarec" }, {}).replayFile).toBe("b.yarec");
    expect(() => resolveSettings({ source: "replay" }, {})).toThrow(/--replay/);
    expect(() => resolveSettings({ source: "tv" }, {})).toThrow(/nieznane/);
    expect(() => resolveSettings({ port: "abc" }, {})).toThrow(/port/);
    expect(() => resolveSettings({ "fast-hz": "20" }, {})).toThrow(/fast-hz/);
  });
});

describe("bridge devices list|revoke", () => {
  it("list, revoke po id i po nazwie, --all, błędy", () => {
    const store = new DeviceStore(dir);
    const a = store.add("Yoga");
    store.add("Telefon");
    const out: string[] = [];
    const say = (l: string) => out.push(l);

    expect(runDevicesCli(["list"], store, say)).toBe(0);
    expect(out.join("\n")).toContain("Yoga");
    expect(out.join("\n")).toContain("Telefon");
    expect(out.join("\n")).not.toContain(a.token);

    out.length = 0;
    expect(runDevicesCli(["revoke", a.device.id], store, say)).toBe(0);
    expect(store.list().map((d) => d.name)).toEqual(["Telefon"]);
    expect(store.verify(a.token)).toBeNull();

    expect(runDevicesCli(["revoke", "Telefon"], store, say)).toBe(0);
    expect(runDevicesCli(["revoke", "nie-ma"], store, say)).toBe(1);
    expect(runDevicesCli(["revoke"], store, say)).toBe(2);
    expect(runDevicesCli(["list"], store, say)).toBe(0);
    expect(out.at(-1)).toMatch(/Brak/);

    store.add("X");
    expect(runDevicesCli(["revoke", "--all"], store, say)).toBe(0);
    expect(store.list()).toHaveLength(0);
    expect(runDevicesCli(["wat"], store, say)).toBe(2);
    store.close();
  });
});

describe("mDNS", () => {
  it("publikuje _yoga-auto._tcp na podanym porcie i sprząta", async () => {
    const calls: string[] = [];
    let cfg: Parameters<BonjourLike["publish"]>[0] | undefined;
    const fake: BonjourLike = {
      publish: (c) => ((cfg = c), calls.push("publish")),
      unpublishAll: (cb) => (calls.push("unpublishAll"), cb?.()),
      destroy: (cb) => (calls.push("destroy"), cb?.()),
    };
    const h = advertise({ port: 7421, version: "9.9.9", protocol: "1", factory: () => fake });
    expect(cfg).toMatchObject({ type: "yoga-auto", protocol: "tcp", port: 7421, txt: { v: "9.9.9", proto: "1" } });
    await h.stop();
    await h.stop(); // idempotentne
    expect(calls).toEqual(["publish", "unpublishAll", "destroy"]);
  });

  it("błąd mDNS nie rzuca", async () => {
    const logs: string[] = [];
    const h = advertise({
      port: 1,
      version: "1",
      protocol: "1",
      factory: () => {
        throw new Error("no multicast");
      },
      log: (_l, m) => logs.push(m),
    });
    expect(logs[0]).toMatch(/niedostępny/);
    await h.stop();
  });
});

describe("opcjonalny rekorder (S7)", () => {
  it("brak pakietu → czytelny błąd", async () => {
    const missing = async () => {
      throw new Error("Cannot find package");
    };
    await expect(loadRecorder("x.yarec", {}, missing)).rejects.toThrow(/@yoga-auto\/recorder/);
    await expect(loadReplaySource({ file: "x", speed: 1, loop: false }, missing)).rejects.toThrow(/niedostępny/);
  });

  it("konstruuje YarecRecorder / ReplaySource z wstrzykniętego modułu", async () => {
    class YarecRecorder {
      file: string;
      opts: unknown;
      constructor(file: string, opts: unknown) {
        this.file = file;
        this.opts = opts;
      }
    }
    class ReplaySource {
      o: { file: string; speed: number; loop: boolean };
      constructor(o: { file: string; speed: number; loop: boolean }) {
        this.o = o;
      }
    }
    const importer = async () => ({ YarecRecorder, ReplaySource });
    const rec = (await loadRecorder("a.yarec", { source: "pipe" }, importer)) as unknown as YarecRecorder;
    expect(rec).toMatchObject({ file: "a.yarec", opts: { meta: { source: "pipe" } } });
    const rs = (await loadReplaySource({ file: "a.yarec", speed: Number("zle"), loop: true }, importer)) as unknown as ReplaySource;
    expect(rs.o).toEqual({ file: "a.yarec", speed: 1, loop: true });
    await expect(loadRecorder("a", {}, async () => ({}))).rejects.toThrow(/YarecRecorder/);
  });
});

describe("inputEnabled: false", () => {
  it("capabilities.input=false, cmd → input_disabled", async () => {
    const b = await startBridge({
      source: createMockSource(),
      port: 0,
      host: "127.0.0.1",
      auth: false,
      inputEnabled: false,
      log: () => {},
    });
    const c = new TestClient(b.port);
    try {
      await c.opened();
      expect((await c.next("hello")).capabilities.input).toBe(false);
      const ack = await c.cmd({ id: "i1", action: "lights.hazard" });
      expect(ack).toMatchObject({ ok: false, error: "input_disabled" });
    } finally {
      c.close();
      await b.close();
    }
  });
});

describe("proces main.ts", () => {
  const main = join(import.meta.dirname, "../src/main.ts");
  const env = () => ({ ...process.env, YOGA_AUTO_DATA_DIR: dir });

  it("`devices list` działa jako subkomenda (bez uruchamiania serwera)", () => {
    new DeviceStore(dir).add("Yoga").device;
    const r = spawnSync(process.execPath, [main, "devices", "list"], { env: env(), encoding: "utf8", timeout: 20_000 });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Yoga");
  });

  it("--source replay / --record bez pakietu rekordera kończy się czytelnym błędem", () => {
    const r = spawnSync(process.execPath, [main, "--source", "replay", "--replay", "x.yarec", "--no-auth", "--no-mdns", "--port", "0"], {
      env: env(),
      encoding: "utf8",
      timeout: 20_000,
    });
    // pakiet może istnieć (po merge S7) — wtedy zabraknie pliku; w obu przypadkach proces nie startuje po cichu
    expect(r.status).not.toBe(0);
  });

  it("config.json wybiera źródło; bridge przeżywa ramkę `null` i nieobsłużone odrzucenie", async () => {
    writeFileSync(join(dir, "config.json"), JSON.stringify({ source: "mock", host: "127.0.0.1", port: 0 }));
    const child = spawn(process.execPath, [main, "--no-auth", "--no-mdns"], { env: env(), stdio: ["ignore", "pipe", "pipe"] });
    try {
      const port = await new Promise<number>((res, rej) => {
        let out = "";
        const t = setTimeout(() => rej(new Error(`timeout: ${out}`)), 15_000);
        child.stdout.on("data", (d) => {
          out += String(d);
          const m = /http:\/\/localhost:(\d+)/.exec(out);
          if (m) {
            clearTimeout(t);
            expect(out).toContain("source=mock");
            res(Number(m[1]));
          }
        });
        child.on("exit", (c) => rej(new Error(`exit ${c}: ${out}`)));
      });
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, [WS_SUBPROTOCOL]);
      await new Promise<void>((r) => ws.once("open", () => r()));
      ws.send("null");
      ws.send("[]");
      await new Promise((r) => setTimeout(r, 300));
      expect(child.exitCode).toBeNull(); // proces żyje
      expect(ws.readyState).toBe(ws.OPEN);
      ws.close();
    } finally {
      child.kill();
    }
  });
});
