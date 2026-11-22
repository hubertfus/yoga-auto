/**
 * Rejestr powierzchni z `backdrop-filter`. Każdy tier ma limit jednoczesnych powierzchni (ultra 8 · high 6 ·
 * lite 4 · flat 0, DESIGN.md §5); ponad limit powierzchnie renderują się jako `flat` (bez backdrop-filter).
 *
 * Wybór: niższy `priority` wygrywa (Dock/Sheet 0, Toast 1, reszta 3), potem kolejność rejestracji.
 * Powierzchnie poza viewportem nie liczą się do limitu.
 */
export interface SurfaceMeta {
  priority: number;
  visible: boolean;
  seq: number;
}

export class SurfaceRegistry {
  private readonly items = new Map<number, SurfaceMeta>();
  private glass = new Set<number>();
  private readonly listeners = new Set<() => void>();
  private _limit = Infinity;
  private seq = 0;
  private nextId = 1;
  private pending = false;
  /** wersja — rośnie przy każdej zmianie wyniku (dla useSyncExternalStore) */
  version = 0;

  get limit(): number {
    return this._limit;
  }

  setLimit(limit: number): void {
    if (limit === this._limit) return;
    this._limit = limit;
    this.recompute();
  }

  /** Rezerwuje identyfikator (bezpieczne w renderze); rejestracja następuje w efekcie. */
  allocId(): number {
    return this.nextId++;
  }

  register(id: number, priority = 3): () => void {
    this.items.set(id, { priority, visible: true, seq: this.seq++ });
    this.recompute();
    return () => {
      if (this.items.delete(id)) this.recompute();
    };
  }

  update(id: number, patch: Partial<Pick<SurfaceMeta, "priority" | "visible">>): void {
    const m = this.items.get(id);
    if (!m) return;
    let changed = false;
    if (patch.priority !== undefined && patch.priority !== m.priority) {
      m.priority = patch.priority;
      changed = true;
    }
    if (patch.visible !== undefined && patch.visible !== m.visible) {
      m.visible = patch.visible;
      changed = true;
    }
    if (changed) this.recompute();
  }

  /** Czy powierzchnia o danym id ma dostać prawdziwe szkło (backdrop-filter). */
  isGlass(id: number): boolean {
    return this.glass.has(id);
  }

  /** Liczba powierzchni aktualnie z backdrop-filter (overlay, testy). */
  get activeCount(): number {
    return this.glass.size;
  }

  get totalCount(): number {
    return this.items.size;
  }

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  private recompute(): void {
    const ranked = [...this.items.entries()]
      .filter(([, m]) => m.visible)
      .sort(([, a], [, b]) => a.priority - b.priority || a.seq - b.seq)
      .slice(0, Number.isFinite(this._limit) ? this._limit : undefined)
      .map(([id]) => id);
    const next = new Set(ranked);
    const same = next.size === this.glass.size && ranked.every((id) => this.glass.has(id));
    this.glass = next;
    if (same) return;
    this.version++;
    this.notify();
  }

  /** Powiadomienia grupowane w mikrozadaniu: montowanie 30 powierzchni = jedno odświeżenie. */
  private notify(): void {
    if (this.pending) return;
    this.pending = true;
    queueMicrotask(() => {
      this.pending = false;
      this.listeners.forEach((l) => l());
    });
  }
}

/** Globalny rejestr biblioteki. */
export const surfaces = new SurfaceRegistry();
