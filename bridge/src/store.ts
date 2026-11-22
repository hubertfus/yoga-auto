/** StateStore: pełny stan + znaczniki zmienionych grup (do płytkich delt). */
import {
  emptyFullState,
  type ConfigState,
  type FastState,
  type FullState,
  type GameStatus,
  type SlowState,
} from "@yoga-auto/protocol";

export class StateStore {
  state: FullState;
  seq = 0;
  readonly dirtyFast = new Set<keyof FastState>();
  readonly dirtySlow = new Set<keyof SlowState>();
  readonly dirtyConfig = new Set<keyof ConfigState>();
  statusDirty = false;

  constructor(source: GameStatus["source"]) {
    this.state = emptyFullState(source);
  }

  setFast<K extends keyof FastState>(key: K, value: FastState[K]): void {
    if (!same(this.state.fast[key], value)) {
      this.state.fast[key] = value;
      this.dirtyFast.add(key);
    }
  }

  setSlow<K extends keyof SlowState>(key: K, value: SlowState[K]): void {
    if (!same(this.state.slow[key], value)) {
      this.state.slow[key] = value;
      this.dirtySlow.add(key);
    }
  }

  setConfig<K extends keyof ConfigState>(key: K, value: ConfigState[K]): void {
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

  takeFast(): Partial<FastState> | null {
    return take(this.dirtyFast, this.state.fast);
  }

  takeSlow(): Partial<SlowState> | null {
    return take(this.dirtySlow, this.state.slow);
  }

  takeConfig(): Partial<ConfigState> | null {
    return take(this.dirtyConfig, this.state.config);
  }

  nextSeq(): number {
    return ++this.seq;
  }
}

function take<T extends object>(dirty: Set<keyof T>, src: T): Partial<T> | null {
  if (!dirty.size) return null;
  const d: Partial<T> = {};
  for (const k of dirty) d[k] = structuredClone(src[k]);
  dirty.clear();
  return d;
}

export function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}
