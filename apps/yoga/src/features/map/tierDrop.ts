/**
 * Lokalny spadek tieru do `lite` na czas panningu/zoomu mapy (DESIGN: mapa jest POD szkłem, więc backdrop-filter
 * nad ruchomą mapą jest najdroższy). glass-ui nie ma (jeszcze) `usePerfTier().override` — jeśli się pojawi, użyj go
 * (`overrideTier`), w przeciwnym razie ustawiamy `data-tier` na <html> i przywracamy `perfStore.applyCurrent()`.
 * Liczy odwołania: kilka widoków mapy naraz nie odblokuje się nawzajem.
 */
import type { PerfTier } from "@yoga-auto/glass-ui";

export interface TierDropEnv {
  /** bieżący tier systemu (perfStore.tier) */
  current(): PerfTier;
  /** zastosuj tier tylko wizualnie (DOM) */
  apply(tier: PerfTier): void;
  /** przywróć tier systemowy */
  restore(): void;
}

const RANK: Record<PerfTier, number> = { flat: 0, lite: 1, high: 2, ultra: 3 };

export function createTierDrop(env: TierDropEnv, target: PerfTier = "lite") {
  let holds = 0;
  let applied = false;
  return {
    begin(): void {
      holds++;
      if (!applied && RANK[env.current()] > RANK[target]) {
        env.apply(target);
        applied = true;
      }
    },
    end(): void {
      if (holds === 0) return;
      holds--;
      if (holds === 0 && applied) {
        env.restore();
        applied = false;
      }
    },
    get active(): boolean {
      return applied;
    },
  };
}
