import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Ajv } from "ajv";
import { describe, expect, it } from "vitest";
import { ACTIONS } from "../src/actions.ts";

const pkg = resolve(import.meta.dirname, "..");
const load = (p: string) => JSON.parse(readFileSync(resolve(pkg, p), "utf8"));
const ajv = new Ajv({ allErrors: true, strict: false });
const v = {
  server: ajv.compile(load("schema/server-msg.schema.json")),
  client: ajv.compile(load("schema/client-msg.schema.json")),
  fromPlugin: ajv.compile(load("schema/ipc-from-plugin.schema.json")),
  toPlugin: ajv.compile(load("schema/ipc-to-plugin.schema.json")),
};

describe("fixtures match schema", () => {
  for (const dir of ["ws", "ipc"] as const) {
    for (const f of readdirSync(resolve(pkg, "fixtures", dir))) {
      it(`${dir}/${f}`, () => {
        const msg = load(`fixtures/${dir}/${f}`);
        const ok = dir === "ws" ? v.server(msg) || v.client(msg) : v.fromPlugin(msg) || v.toPlugin(msg);
        expect(
          ok,
          JSON.stringify([v.server.errors, v.client.errors, v.fromPlugin.errors].filter(Boolean)).slice(0, 800),
        ).toBe(true);
      });
    }
  }
});

describe("ACTIONS catalog", () => {
  it("set actions declare values", () => {
    for (const [id, a] of Object.entries(ACTIONS)) {
      if (a.kind === "set") expect((a as { values?: readonly string[] }).values?.length, id).toBeGreaterThan(0);
    }
  });
  it("ids are dotted camelCase", () => {
    for (const id of Object.keys(ACTIONS)) expect(id).toMatch(/^[a-z][A-Za-z]*(\.[a-z0-9][A-Za-z0-9]*)*$/);
  });
});
