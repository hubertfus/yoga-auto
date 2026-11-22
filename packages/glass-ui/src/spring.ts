/**
 * Minimalna sprężyna do interpolacji telemetrii (wskazówki, łuki).
 * Nie restartuje animacji przy każdym `set()` (60 Hz): jedna pętla rAF goni cel, aż się uspokoi.
 * Całkowanie półjawne Eulera z podkrokami — stabilne dla sztywności z tokenów (≤ 520).
 */
import { springs, type SpringName } from "@yoga-auto/design-tokens";

export interface SpringParams {
  stiffness: number;
  damping: number;
  mass: number;
}

export function springParams(name: SpringName): SpringParams {
  return springs[name];
}

export interface SpringStepResult {
  x: number;
  v: number;
}

/** Jeden krok sprężyny (czysta funkcja — testowalna bez rAF). */
export function stepSpring(x: number, v: number, target: number, p: SpringParams, dt: number): SpringStepResult {
  const sub = 1 / 240;
  let t = dt;
  while (t > 1e-9) {
    const h = Math.min(sub, t);
    const a = (-p.stiffness * (x - target) - p.damping * v) / p.mass;
    v += a * h;
    x += v * h;
    t -= h;
  }
  return { x, v };
}

export class SpringFollower {
  private x: number;
  private v = 0;
  private target: number;
  private raf = 0;
  private last = 0;
  private readonly params: SpringParams;
  private readonly apply: (x: number) => void;
  private animated: boolean | (() => boolean);

  constructor(
    initial: number,
    apply: (x: number) => void,
    spring: SpringName | SpringParams = "gauge",
    /** `false` = bez ruchu (prefers-reduced-motion): skok do celu */
    animated: boolean | (() => boolean) = true,
  ) {
    this.apply = apply;
    this.animated = animated;
    this.x = initial;
    this.target = initial;
    this.params = typeof spring === "string" ? springParams(spring) : spring;
  }

  get value(): number {
    return this.x;
  }

  get settled(): boolean {
    return this.raf === 0;
  }

  set(target: number): void {
    this.target = target;
    const anim = typeof this.animated === "function" ? this.animated() : this.animated;
    if (!anim) {
      this.x = target;
      this.v = 0;
      this.apply(target);
      return;
    }
    if (this.raf === 0) {
      this.last = 0;
      this.raf = requestAnimationFrame(this.tick);
    }
  }

  /** Natychmiast, bez animacji (inicjalizacja, zmiana zakresu). */
  jump(value: number): void {
    this.stop();
    this.x = this.target = value;
    this.v = 0;
    this.apply(value);
  }

  stop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private tick = (now: number): void => {
    const dt = this.last ? Math.min((now - this.last) / 1000, 0.05) : 1 / 60;
    this.last = now;
    const r = stepSpring(this.x, this.v, this.target, this.params, dt);
    this.x = r.x;
    this.v = r.v;
    const done = Math.abs(this.x - this.target) < 1e-3 && Math.abs(this.v) < 1e-2;
    if (done) {
      this.x = this.target;
      this.v = 0;
      this.raf = 0;
    } else {
      this.raf = requestAnimationFrame(this.tick);
    }
    this.apply(this.x);
  };
}
