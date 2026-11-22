/** Rate limit komend per klient: okno przesuwne 1 s (PROTOCOL.md §4: > 20/s → `rate_limited`). */
import { CMD_RATE_LIMIT_PER_S } from "@yoga-auto/protocol";

export type RateVerdict = "ok" | "limited" | "flood";

export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  private readonly limit: number;
  private readonly floodFactor: number;
  private readonly now: () => number;

  /**
   * @param limit        maks. komend w oknie 1 s
   * @param floodFactor  powyżej `limit * floodFactor` w oknie → "flood" (serwer zamyka połączenie kodem 4008)
   */
  constructor(limit = CMD_RATE_LIMIT_PER_S, floodFactor = 5, now: () => number = Date.now) {
    this.limit = limit;
    this.floodFactor = floodFactor;
    this.now = now;
  }

  hit(clientId: string): RateVerdict {
    const t = this.now();
    const arr = this.hits.get(clientId) ?? [];
    this.hits.set(clientId, arr);
    while (arr.length && t - arr[0]! >= 1000) arr.shift();
    arr.push(t);
    if (arr.length > this.limit * this.floodFactor) return "flood";
    return arr.length > this.limit ? "limited" : "ok";
  }

  forget(clientId: string): void {
    this.hits.delete(clientId);
  }
}
