/** Katalog danych bridge'a: `%APPDATA%\yoga-auto` (Windows), `~/.config/yoga-auto` gdzie indziej. */
import { homedir } from "node:os";
import { join } from "node:path";

export function dataDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env["YOGA_AUTO_DATA_DIR"]) return env["YOGA_AUTO_DATA_DIR"];
  if (env["APPDATA"]) return join(env["APPDATA"], "yoga-auto");
  return join(env["XDG_CONFIG_HOME"] ?? join(homedir(), ".config"), "yoga-auto");
}
