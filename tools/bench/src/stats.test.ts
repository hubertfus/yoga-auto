import { describe, expect, it } from "vitest";
import { analyzeFrames, percentile, summarize } from "./stats.ts";

describe("stats", () => {
  it("percentyle metodą nearest-rank", () => {
    const v = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(v, 50)).toBe(50);
    expect(percentile(v, 95)).toBe(95);
    expect(percentile(v, 99)).toBe(99);
    expect(percentile([], 50)).toBeNaN();
  });
  it("summarize", () => {
    const s = summarize([3, 1, 2]);
    expect(s).toMatchObject({ n: 3, mean: 2, p50: 2, max: 3 });
  });
  it("analyzeFrames: stałe 60 Hz bez zgubionych", () => {
    const r = analyzeFrames(Array(120).fill(1000 / 60));
    expect(r.fps).toBeCloseTo(60, 0);
    expect(r.dropped).toBe(0);
  });
  it("analyzeFrames: liczy zgubione i jank", () => {
    const d = [...Array(58).fill(16.67), 40, 80];
    const r = analyzeFrames(d);
    expect(r.dropped).toBe(2);
    expect(r.jank).toBe(1);
    expect(r.frameMs.max).toBe(80);
  });
});
