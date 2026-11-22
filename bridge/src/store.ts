/**
 * StateStore: pełny bieżący stan. Delty fast/slow liczy per klient `ClientStream` (throttle.ts);
 * tutaj zostają tylko znaczniki dla kanałów „przy zmianie” (config, status).
 */
import {
  emptyFullState,
  type Alert,
  type ConfigState,
  type FastState,
  type FullState,
  type GameStatus,
  type SlowState,
} from "@yoga-auto/protocol";

export class StateStore {
  state: FullState;
  readonly dirtyConfig = new Set<keyof ConfigState>();
  statusDirty = false;
  /** rośnie przy każdej zmianie fast (tani test „czy w ogóle coś się zmieniło”) */
  fastVersion = 0;
  slowVersion = 0;

  constructor(source: GameStatus["source"]) {
    this.state = emptyFullState(source);
  }

  setFast<K extends keyof FastState>(key: K, value: FastState[K]): void {
    if (!same(this.state.fast[key], value)) {
      this.state.fast[key] = value;
      this.fastVersion++;
    }
  }

  setSlow<K extends keyof SlowState>(key: K, value: SlowState[K]): void {
    if (!same(this.state.slow[key], value)) {
      this.state.slow[key] = value;
      this.slowVersion++;
    }
  }

  setConfig<K extends keyof ConfigState>(key: K, value: ConfigState[K]): void {
    if (same(this.state.config[key], value)) return;
    this.state.config[key] = value;
    this.dirtyConfig.add(key);
  }

  setStatus(patch: Partial<GameStatus>): void {
    const next = { ...this.state.status, ...patch };
    if (!same(next, this.state.status)) {
      this.state.status = next;
      this.statusDirty = true;
    }
  }

  setAlerts(alerts: Alert[]): void {
    this.state.alerts = alerts;
  }

  takeConfig(): Partial<ConfigState> | null {
    if (!this.dirtyConfig.size) return null;
    const d: Partial<ConfigState> = {};
    for (const k of this.dirtyConfig) (d as Record<string, unknown>)[k] = structuredClone(this.state.config[k]);
    this.dirtyConfig.clear();
    return d;
  }
}

export function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}
