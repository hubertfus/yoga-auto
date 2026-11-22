/** Generuje JSON Schema z typów TS → shared/protocol/schema/*.schema.json */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createGenerator } from "ts-json-schema-generator";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = resolve(here, "..");
const targets: [file: string, type: string, out: string][] = [
  ["src/messages.ts", "ServerMsg", "server-msg"],
  ["src/messages.ts", "ClientMsg", "client-msg"],
  ["src/ipc.ts", "IpcFromPlugin", "ipc-from-plugin"],
  ["src/ipc.ts", "IpcToPlugin", "ipc-to-plugin"],
];
mkdirSync(resolve(pkg, "schema"), { recursive: true });
for (const [file, type, out] of targets) {
  const schema = createGenerator({
    path: resolve(pkg, file),
    tsconfig: resolve(pkg, "../../tsconfig.base.json"),
    type,
    expose: "export",
    topRef: true,
    skipTypeCheck: true,
    additionalProperties: true,
  }).createSchema(type);
  writeFileSync(resolve(pkg, "schema", `${out}.schema.json`), JSON.stringify(schema, null, 2) + "\n");
  console.log("schema:", out);
}
