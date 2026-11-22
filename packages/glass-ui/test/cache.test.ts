import { describe, expect, it } from "vitest";
import { DisplacementCache, mapKey, computeDisplacementMap } from "../src/index.ts";

const render = (m: { width: number; height: number }) => `data:fake,${m.width}x${m.height}`;

describe("DisplacementCache", () => {
  it("generuje mapę raz dla tego samego w×h×r", () => {
    const cache = new DisplacementCache({ render });
    const a = cache.acquire(200, 100, 20);
    const b = cache.acquire(200, 100, 20);
    expect(a).toBe(b);
    expect(cache.generated).toBe(1);
    expect(b.refs).toBe(2);
    cache.acquire(200, 100, 24);
    expect(cache.generated).toBe(2);
  });

  it("zaokrągla wymiary do pełnych pikseli (jeden klucz)", () => {
    const cache = new DisplacementCache({ render });
    cache.acquire(200.2, 100.4, 20);
    cache.acquire(199.9, 99.8, 20.3);
    expect(cache.generated).toBe(1);
    expect(mapKey(200.2, 100.4, 20)).toBe(mapKey(199.9, 99.8, 20.3));
  });

  it("LRU usuwa tylko wpisy bez referencji i woła onEvict", () => {
    const cache = new DisplacementCache({ render, max: 2 });
    const evicted: string[] = [];
    cache.onEvict = (k) => evicted.push(k);
    const a = cache.acquire(100, 50, 10);
    cache.acquire(110, 50, 10); // trzymana
    cache.release(a.key);
    cache.acquire(120, 50, 10);
    expect(cache.size).toBe(2);
    expect(evicted).toEqual([a.key]);
    expect(cache.has(110, 50, 10)).toBe(true);
  });

  it("mapa surowa ma rozmiar w×h×4 i płaski środek", () => {
    const m = computeDisplacementMap({ w: 64, h: 64, radius: 16 });
    expect(m.data.length).toBe(m.width * m.height * 4);
    const mid = (Math.floor(m.height / 2) * m.width + Math.floor(m.width / 2)) * 4;
    expect(Math.abs(m.data[mid]! - 128)).toBeLessThanOrEqual(2);
    expect(Math.abs(m.data[mid + 1]! - 128)).toBeLessThanOrEqual(2);
  });
});
