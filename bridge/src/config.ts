/**
 * Konfiguracja bridge'a: `%APPDATA%\yoga-auto\config.json` + flagi CLI.
 * Pierwszeństwo: CLI > config.json > domyślne. Błędne pola są pomijane z ostrzeżeniem (bridge ma wstać).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_PORT } from "@yoga-auto/protocol";

export type SourceKind = "mock" | "pipe" | "replay";

export interface FileConfig {
  port?: number;
  host?: string;
  fastHz?: 15 | 30 | 60;
  /** `mock` | `pipe` | `replay` | `replay:<plik.yarec>` */
  source?: string;
  inputEnabled?: boolean;
}

export const CONFIG_FILE = "config.json";

/** Wczytaj `config.json` z katalogu danych. Brak pliku = `{}`; zły JSON/pola → ostrzeżenia w `warnings`. */
export function loadConfig(dir: string): { config: FileConfig; warnings: string[] } {
  const file = join(dir, CONFIG_FILE);
  const warnings: string[] = [];
  if (!existsSync(file)) return { config: {}, warnings };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    return { config: {}, warnings: [`${file}: nieprawidłowy JSON (${String(e)}), używam domyślnych`] };
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    return { config: {}, warnings: [`${file}: oczekiwano obiektu, używam domyślnych`] };
  const o = raw as Record<string, unknown>;
  const config: FileConfig = {};
  if (o["port"] !== undefined) {
    if (Number.isInteger(o["port"]) && (o["port"] as number) >= 0 && (o["port"] as number) <= 65535)
      config.port = o["port"] as number;
    else warnings.push(`config.port: oczekiwano 0..65535, pomijam`);
  }
  if (o["host"] !== undefined) {
    if (typeof o["host"] === "string" && o["host"]) config.host = o["host"];
    else warnings.push(`config.host: oczekiwano niepustego tekstu, pomijam`);
  }
  if (o["fastHz"] !== undefined) {
    if (o["fastHz"] === 15 || o["fastHz"] === 30 || o["fastHz"] === 60) config.fastHz = o["fastHz"];
    else warnings.push(`config.fastHz: dozwolone 15|30|60, pomijam`);
  }
  if (o["source"] !== undefined) {
    if (typeof o["source"] === "string" && /^(mock|pipe|replay(:.+)?)$/.test(o["source"])) config.source = o["source"];
    else warnings.push(`config.source: dozwolone mock|pipe|replay|replay:<plik>, pomijam`);
  }
  if (o["inputEnabled"] !== undefined) {
    if (typeof o["inputEnabled"] === "boolean") config.inputEnabled = o["inputEnabled"];
    else warnings.push(`config.inputEnabled: oczekiwano true/false, pomijam`);
  }
  return { config, warnings };
}

export interface CliValues {
  source?: string | undefined;
  replay?: string | undefined;
  port?: string | undefined;
  host?: string | undefined;
  "fast-hz"?: string | undefined;
}

export interface Settings {
  source: SourceKind;
  replayFile: string | null;
  port: number;
  host: string;
  fastHz: 15 | 30 | 60;
  inputEnabled: boolean;
}

/** Złóż ustawienia: CLI > config > domyślne. Rzuca czytelny błąd dla złych flag CLI. */
export function resolveSettings(cli: CliValues, cfg: FileConfig): Settings {
  const srcRaw = cli.source ?? cfg.source ?? "pipe";
  const m = /^(mock|pipe|replay)(?::(.+))?$/.exec(srcRaw);
  if (!m) throw new Error(`nieznane --source ${srcRaw} (mock | pipe | replay | replay:<plik.yarec>)`);
  const source = m[1] as SourceKind;
  const replayFile = source === "replay" ? (m[2] ?? cli.replay ?? null) : null;
  if (source === "replay" && !replayFile) throw new Error("--source replay wymaga --replay <plik.yarec> (lub replay:<plik>)");

  const port = cli.port !== undefined ? Number(cli.port) : (cfg.port ?? DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`zły --port ${cli.port}`);
  const fastHz = cli["fast-hz"] !== undefined ? Number(cli["fast-hz"]) : (cfg.fastHz ?? 30);
  if (fastHz !== 15 && fastHz !== 30 && fastHz !== 60) throw new Error(`zły --fast-hz ${cli["fast-hz"]} (15|30|60)`);
  return {
    source,
    replayFile,
    port,
    host: cli.host ?? cfg.host ?? "0.0.0.0",
    fastHz,
    inputEnabled: cfg.inputEnabled ?? true,
  };
}
