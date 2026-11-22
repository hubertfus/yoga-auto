/** Ogłoszenie bridge'a w LAN przez mDNS: `_yoga-auto._tcp` (bonjour-service). Błąd mDNS nigdy nie zatrzymuje bridge'a. */
import { hostname } from "node:os";
import { Bonjour } from "bonjour-service";

/** Minimalny kształt klienta Bonjour (do podmiany w testach). */
export interface BonjourLike {
  publish(cfg: { name: string; type: string; protocol: "tcp"; port: number; txt?: Record<string, string> }): unknown;
  unpublishAll(cb?: () => void): void;
  destroy(cb?: () => void): void;
}

export const MDNS_TYPE = "yoga-auto"; // → _yoga-auto._tcp

export interface MdnsOptions {
  port: number;
  version: string;
  protocol: string;
  name?: string;
  factory?: () => BonjourLike;
  log?: (level: "info" | "warn", msg: string) => void;
}

export function advertise(opts: MdnsOptions): { stop(): Promise<void> } {
  const log = opts.log ?? (() => {});
  let b: BonjourLike | null = null;
  try {
    b = (opts.factory ?? (() => new Bonjour() as unknown as BonjourLike))();
    b.publish({
      name: opts.name ?? `yoga-auto-${hostname()}`,
      type: MDNS_TYPE,
      protocol: "tcp",
      port: opts.port,
      txt: { v: opts.version, proto: opts.protocol, path: "/" },
    });
    log("info", `mDNS: _${MDNS_TYPE}._tcp na porcie ${opts.port}`);
  } catch (e) {
    log("warn", `mDNS niedostępny: ${String(e)}`);
    b = null;
  }
  return {
    async stop() {
      const cur = b;
      b = null;
      if (!cur) return;
      await new Promise<void>((r) => {
        try {
          cur.unpublishAll(() => {
            try {
              cur.destroy(() => r());
            } catch {
              r();
            }
          });
        } catch {
          r();
        }
      });
    },
  };
}
