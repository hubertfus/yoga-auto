/**
 * Kontrakt przekrojowy: fixture'y vs JSON Schema.
 * Uzupełnia shared/protocol/test/contract.test.ts (lead): tu sprawdzamy kierunek (ws → server|client, ipc → from|to plugin)
 * oraz pokrycie — każdy typ wiadomości ze schematu ma co najmniej jeden fixture, a negatywne przypadki są odrzucane.
 */
import { describe, expect, it } from "vitest";
import { ACTIONS } from "@yoga-auto/protocol";
import { loadFixtures, schemaTypes, violations } from "../support/schemas.ts";

const t = (m: unknown) => (m as { t: string }).t;

describe("ws fixtures", () => {
  const server = new Set(schemaTypes("server-msg.schema.json"));
  const client = new Set(schemaTypes("client-msg.schema.json"));
  for (const { name, msg } of loadFixtures("ws")) {
    it(`${name} is valid for the direction implied by its type`, () => {
      if (server.has(t(msg))) expect(violations("server", msg)).toBeNull();
      else if (client.has(t(msg))) expect(violations("client", msg)).toBeNull();
      else throw new Error(`fixture type "${t(msg)}" unknown to both schemas`);
    });
  }
  it("cmd fixtures reference existing actions with legal op/value", () => {
    for (const { name, msg } of loadFixtures("ws").filter((f) => t(f.msg) === "cmd")) {
      const m = msg as { action: keyof typeof ACTIONS; op?: string; value?: string };
      const def = ACTIONS[m.action];
      expect(def, `${name}: unknown action ${m.action}`).toBeDefined();
      if (def.kind === "set") expect((def as { values: readonly string[] }).values, name).toContain(m.value);
      if (def.kind === "hold") expect(["down", "up", "keep"], name).toContain(m.op);
      if (def.kind === "press") expect(m.op, name).toBeUndefined();
    }
  });
});

describe("ipc fixtures", () => {
  const from = new Set(schemaTypes("ipc-from-plugin.schema.json"));
  const to = new Set(schemaTypes("ipc-to-plugin.schema.json"));
  for (const { name, msg } of loadFixtures("ipc")) {
    it(`${name} is valid for the direction implied by its type`, () => {
      if (from.has(t(msg))) expect(violations("fromPlugin", msg)).toBeNull();
      else if (to.has(t(msg))) expect(violations("toPlugin", msg)).toBeNull();
      else throw new Error(`fixture type "${t(msg)}" unknown to both schemas`);
    });
  }
});

/**
 * Pokrycie: każdy typ wiadomości ze schematu powinien mieć fixture (żeby S1/S4 mieli na czym testować).
 * Luki są raportowane jako lista w nazwie testu i NIE failują buildu (lead dopisuje fixture'y wg propozycji
 * docs/proposals/s7-fixtures-coverage.md) — ale test failuje, gdy luka urośnie ponad zapisaną listę.
 */
describe("fixture coverage", () => {
  const KNOWN_WS_GAPS = new Set([
    "config",
    "media",
    "pong",
    "snapshot",
    "status",
    "ping",
    "resync",
    "subscribe",
    "trip.reset",
  ]);
  const KNOWN_IPC_GAPS = new Set(["cfg", "evt", "input.active", "in.ack", "log", "hb", "releaseAll", "opts"]);

  it("ws: no NEW uncovered message types", () => {
    const have = new Set(loadFixtures("ws").map((f) => t(f.msg)));
    const all = [...schemaTypes("server-msg.schema.json"), ...schemaTypes("client-msg.schema.json")];
    const missing = all.filter((x) => !have.has(x));
    const unexpected = missing.filter((x) => !KNOWN_WS_GAPS.has(x));
    expect(unexpected, `new gaps: ${unexpected.join(", ")}`).toEqual([]);
    console.info(`[fixture coverage] ws types without fixture: ${missing.join(", ") || "none"}`);
  });

  it("ipc: no NEW uncovered message types", () => {
    const have = new Set(loadFixtures("ipc").map((f) => t(f.msg)));
    const all = [...schemaTypes("ipc-from-plugin.schema.json"), ...schemaTypes("ipc-to-plugin.schema.json")];
    const missing = all.filter((x) => !have.has(x));
    const unexpected = missing.filter((x) => !KNOWN_IPC_GAPS.has(x));
    expect(unexpected, `new gaps: ${unexpected.join(", ")}`).toEqual([]);
    console.info(`[fixture coverage] ipc types without fixture: ${missing.join(", ") || "none"}`);
  });
});

describe("schema rejects broken messages (negative)", () => {
  const bad: [string, "server" | "client" | "fromPlugin" | "toPlugin", unknown][] = [
    ["tel without ch", "fromPlugin", { t: "tel", frame: 1, simTime: 0, renderTime: 0, paused: false }],
    ["tel with string frame", "fromPlugin", { t: "tel", frame: "1", simTime: 0, renderTime: 0, paused: false, ch: {} }],
    ["hello without channels", "fromPlugin", { t: "hello", ipc: 1 }],
    ["in with bad op", "toPlugin", { t: "in", seq: 1, device: "semantical", input: "light", op: "tap" }],
    ["in with bad device", "toPlugin", { t: "in", seq: 1, device: "keyboard", input: "light", op: "press" }],
    ["unknown ipc type", "fromPlugin", { t: "nope" }],
    ["cmd without id", "client", { t: "cmd", action: "horn" }],
    ["cmd with unknown action", "client", { t: "cmd", id: "1", action: "warp.drive" }],
    ["ping without t0", "client", { t: "ping" }],
    ["fast without frame", "server", { t: "fast", seq: 1, ts: 1, d: {} }],
    ["ack without ok", "server", { t: "ack", id: "1", tookMs: 3 }],
    ["pong with string t0", "server", { t: "pong", t0: "x", ts: 1 }],
  ];
  for (const [name, v, msg] of bad) {
    it(name, () => expect(violations(v, msg), "should have been rejected").not.toBeNull());
  }
});
