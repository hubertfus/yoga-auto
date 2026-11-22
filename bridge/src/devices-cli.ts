/** Subkomenda `bridge devices list|revoke <id|nazwa>|revoke --all` (osobny proces; działający bridge odświeża plik). */
import type { DeviceStore } from "./devices.ts";

const fmt = (t: number | null) => (t ? new Date(t).toISOString().replace("T", " ").slice(0, 19) : "-");

/** Zwraca kod wyjścia procesu. */
export function runDevicesCli(args: string[], store: DeviceStore, out: (line: string) => void = console.log): number {
  const [cmd, ...rest] = args;
  switch (cmd) {
    case "list": {
      const list = store.list();
      if (!list.length) {
        out("Brak sparowanych urządzeń.");
        return 0;
      }
      out("ID        NAZWA                 OSTATNIE IP      OSTATNIO WIDZIANE    UTWORZONE");
      for (const d of list)
        out(`${d.id.padEnd(9)} ${d.name.padEnd(21)} ${(d.lastIp ?? "-").padEnd(16)} ${fmt(d.lastSeenAt).padEnd(20)} ${fmt(d.createdAt)}`);
      return 0;
    }
    case "revoke": {
      if (rest[0] === "--all") {
        out(`Odwołano urządzeń: ${store.revokeAll()}`);
        return 0;
      }
      const target = rest[0];
      if (!target) {
        out("Użycie: bridge devices revoke <id|nazwa> | --all");
        return 2;
      }
      const d = store.revoke(target);
      if (!d) {
        out(`Nie znaleziono urządzenia „${target}” (nazwa musi być jednoznaczna; użyj id z \`devices list\`).`);
        return 1;
      }
      out(`Odwołano: ${d.name} (${d.id}). Działający bridge rozłączy je w ciągu kilku sekund.`);
      return 0;
    }
    default:
      out("Użycie: bridge devices list | revoke <id|nazwa> | revoke --all");
      return cmd === undefined ? 0 : 2;
  }
}
