/** Proste metryki latencji (pierścień próbek + percentyle) do logów debug. */
export class LatencyStats {
  private readonly buf: Float64Array;
  private n = 0;
  private i = 0;

  constructor(size = 2048) {
    this.buf = new Float64Array(size);
  }

  add(ms: number): void {
    this.buf[this.i] = ms;
    this.i = (this.i + 1) % this.buf.length;
    if (this.n < this.buf.length) this.n++;
  }

  get count(): number {
    return this.n;
  }

  percentile(p: number): number {
    if (!this.n) return 0;
    const s = Array.from(this.buf.subarray(0, this.n)).sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!;
  }

  summary(): { n: number; p50: number; p95: number; p99: number; max: number } {
    return {
      n: this.n,
      p50: this.percentile(50),
      p95: this.percentile(95),
      p99: this.percentile(99),
      max: this.percentile(100),
    };
  }

  reset(): void {
    this.n = 0;
    this.i = 0;
  }
}
