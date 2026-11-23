/**
 * Zapis nieznanych/nieopisanych danych SDK do `sdk-discovery.jsonl` (katalog danych bridge'a).
 *
 * Kursy autobusowe (SDK 1.20, ETS2 1.61+) mają konfigurację `bus_job` i zdarzenia `bus_job.*`, ale SCS nie
 * opisało ich atrybutów. Żeby dopasować mapowanie do prawdziwej gry, każdą nową kombinację (id + zestaw
 * nazw atrybutów) zapisujemy raz z przykładowymi wartościami. Plik jest mały (wpis tylko przy nowym kształcie).
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { ipc } from "@yoga-auto/protocol";

/** Konfiguracje i zdarzenia, które bridge zna i mapuje w pełni — tych nie zapisujemy. */
const KNOWN_CFG = /^(job|truck|trailer(\.\d+)?|controls|hshifter|substances)$/;
const KNOWN_EVT = new Set([
  "job.delivered",
  "job.cancelled",
  "player.fined",
  "player.tollgate.paid",
  "player.use.ferry",
  "player.use.train",
  "player.refuel.paid",
]);

export interface DiscoveryEntry {
  ts: number;
  kind: "cfg" | "evt";
  id: string;
  attrs: Record<string, unknown> | null;
}

export class SdkDiscovery {
  private readonly seen = new Set<string>();
  private readonly write: (e: DiscoveryEntry) => void;
  private readonly log: (msg: string) => void;

  constructor(file: string | null, log: (msg: string) => void = () => {}) {
    this.log = log;
    this.write = file
      ? (e) => {
          try {
            mkdirSync(dirname(file), { recursive: true });
            appendFileSync(file, JSON.stringify(e) + "\n", "utf8");
          } catch {
            // best-effort
          }
        }
      : () => {};
  }

  /** Zwraca wpis, jeśli to nowy kształt danych (zapisany), inaczej null. */
  record(m: ipc.IpcConfig | ipc.IpcGameplay, now = Date.now()): DiscoveryEntry | null {
    const kind = m.t;
    if (kind === "cfg" ? KNOWN_CFG.test(m.id) : KNOWN_EVT.has(m.id)) return null;
    const keys = m.attrs ? Object.keys(m.attrs).sort().join(",") : "∅";
    const key = `${kind}|${m.id}|${keys}`;
    if (this.seen.has(key)) return null;
    this.seen.add(key);
    const e: DiscoveryEntry = { ts: now, kind, id: m.id, attrs: m.attrs };
    this.write(e);
    this.log(`SDK ${kind === "cfg" ? "konfiguracja" : "zdarzenie"} ${m.id}: ${keys}`);
    return e;
  }
}
