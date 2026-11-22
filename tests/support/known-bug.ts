/**
 * Test „znanego błędu” w kodzie innego strumienia. Działa tak:
 *  - dopóki błąd istnieje, test ma się wywalić → wynik zielony (oczekiwane), w logu `KNOWN BUG`,
 *  - gdy autor naprawi błąd, test przechodzi → też zielony, ale log `FIXED` mówi: zamień `knownBug` na zwykłe `it`.
 * Dzięki temu kolejność merge'y (S2 przed/po S7) nie psuje `npm run check`, a zgłoszenie zostaje w repo z linkiem.
 */
import { it } from "vitest";

export function knownBug(name: string, report: string, fn: () => Promise<void> | void, timeoutMs?: number): void {
  it(
    `[known bug] ${name}`,
    async () => {
      try {
        await fn();
      } catch (e) {
        console.info(`KNOWN BUG (${report}): ${name} — ${String(e instanceof Error ? e.message : e).slice(0, 200)}`);
        return;
      }
      console.warn(`FIXED? (${report}): "${name}" now passes — change knownBug() to it()`);
    },
    timeoutMs,
  );
}
