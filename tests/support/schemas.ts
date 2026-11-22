/** Walidatory JSON Schema kontraktu (shared/protocol/schema) — wspólne dla testów przekrojowych. */
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Ajv, type ValidateFunction } from "ajv";

export const protocolDir = resolve(import.meta.dirname, "../../shared/protocol");
const ajv = new Ajv({ allErrors: true, strict: false });
const compile = (file: string): ValidateFunction =>
  ajv.compile(JSON.parse(readFileSync(resolve(protocolDir, "schema", file), "utf8")));

export const validators = {
  server: compile("server-msg.schema.json"),
  client: compile("client-msg.schema.json"),
  fromPlugin: compile("ipc-from-plugin.schema.json"),
  toPlugin: compile("ipc-to-plugin.schema.json"),
};

export type ValidatorName = keyof typeof validators;

/** Zwraca opis błędów albo null, gdy wiadomość jest zgodna. */
export function violations(name: ValidatorName, msg: unknown): string | null {
  const v = validators[name];
  if (v(msg)) return null;
  const t = msg && typeof msg === "object" ? (msg as { t?: unknown }).t : typeof msg;
  return `${name} ${String(t)}: ${ajv.errorsText(v.errors, { separator: "; " }).slice(0, 400)}`;
}

/** Wszystkie wartości `t` (const) dopuszczone przez schemat. */
export function schemaTypes(file: string): string[] {
  const s = JSON.parse(readFileSync(resolve(protocolDir, "schema", file), "utf8")) as {
    definitions: Record<string, { properties?: { t?: { const?: string } } }>;
  };
  const out = new Set<string>();
  for (const d of Object.values(s.definitions)) {
    const c = d.properties?.t?.const;
    if (c) out.add(c);
  }
  return [...out].sort();
}

export function loadFixtures(dir: "ws" | "ipc"): { name: string; msg: unknown }[] {
  const base = resolve(protocolDir, "fixtures", dir);
  return readdirSync(base)
    .filter((f) => f.endsWith(".json"))
    .map((f) => ({ name: f, msg: JSON.parse(readFileSync(resolve(base, f), "utf8")) as unknown }));
}
