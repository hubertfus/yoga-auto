import { describe, expect, it } from "vitest";
import { PerfTierController, computeFrameStats } from "../src/perf.tsx";
import type { FrameStats } from "../src/types.ts";

const stat = (p95: number, p50 = 16.7): FrameStats => ({ p50, p95, p99: p95 + 2, fps: 60, samples: 120 });

function make(opts: ConstructorParameters<typeof PerfTierController>[0] = {}) {
  let t = 0;
  const c = new PerfTierController({ now: () => t, ...opts });
  return { c, advance: (ms: number) => (t += ms) };
}

describe("PerfTierController — degradacja", () => {
  it("jedno złe okno nie degraduje, dwa kolejne tak", () => {
    const { c, advance } = make({ initial: "high" });
    expect(c.push(stat(25))).toBeNull();
    advance(2000);
    const ch = c.push(stat(25));
    expect(ch).toMatchObject({ from: "high", to: "lite", reason: "degrade" });
    expect(c.tier).toBe("lite");
  });

  it("dobre okno między złymi zeruje licznik", () => {
    const { c, advance } = make({ initial: "high" });
    c.push(stat(25));
    advance(2000);
    c.push(stat(10, 8));
    advance(2000);
    expect(c.push(stat(25))).toBeNull();
    expect(c.tier).toBe("high");
  });

  it("lite ma próg 22 ms, flat nie degraduje dalej", () => {
    const { c } = make({ initial: "lite" });
    c.push(stat(20));
    expect(c.push(stat(20))).toBeNull();
    c.push(stat(23));
    expect(c.push(stat(23))?.to).toBe("flat");
    for (let i = 0; i < 5; i++) expect(c.push(stat(99))).toBeNull();
    expect(c.tier).toBe("flat");
  });
});

describe("PerfTierController — awans z histerezą (fake time)", () => {
  it("awansuje dopiero po 30 s dobrych klatek", () => {
    const { c, advance } = make({ initial: "lite" });
    let change = null;
    for (let i = 0; i < 14; i++) {
      advance(2000);
      change = c.push(stat(10, 8));
      if (change) break;
    }
    expect(change).toBeNull();
    for (let i = 0; i < 3 && !change; i++) {
      advance(2000);
      change = c.push(stat(10, 8));
    }
    expect(change).toMatchObject({ from: "lite", to: "high", reason: "upgrade" });
  });

  it("nie awansuje ponad sufit (ultra tylko ręcznie)", () => {
    const { c, advance } = make({ initial: "high" });
    for (let i = 0; i < 40; i++) {
      advance(2000);
      c.push(stat(10, 8));
    }
    expect(c.tier).toBe("high");
  });

  it("maks. 1 awans na 5 min", () => {
    const { c, advance } = make({ initial: "flat", ceiling: "high" });
    const ups: number[] = [];
    for (let i = 0; i < 400; i++) {
      advance(2000);
      if (c.push(stat(10, 8))?.reason === "upgrade") ups.push(i * 2000);
    }
    expect(ups.length).toBeGreaterThanOrEqual(2);
    expect(ups[1]! - ups[0]!).toBeGreaterThanOrEqual(5 * 60_000);
  });

  it("flapping: tier, który spadł <2 min po awansie, jest blokowany", () => {
    const { c, advance } = make({ initial: "lite" });
    for (let i = 0; i < 20 && c.tier === "lite"; i++) {
      advance(2000);
      c.push(stat(10, 8));
    }
    expect(c.tier).toBe("high");
    advance(2000);
    c.push(stat(30));
    advance(2000);
    c.push(stat(30));
    expect(c.tier).toBe("lite");
    expect(c.isBanned("high")).toBe(true);
    for (let i = 0; i < 200; i++) {
      advance(2000);
      c.push(stat(10, 8));
    }
    expect(c.tier).toBe("lite"); // 400 s < 30 min bana
  });
});

describe("PerfTierController — tryby", () => {
  it("tryb ręczny wyłącza auto-degradację", () => {
    const { c } = make({ mode: "ultra" });
    c.push(stat(40));
    c.push(stat(40));
    expect(c.tier).toBe("ultra");
  });

  it("bateria < 20% ogranicza do lite tylko w trybie auto", () => {
    const { c } = make({ initial: "high" });
    expect(c.setBatteryLow(true)).toMatchObject({ to: "lite", reason: "battery" });
    const manual = make({ mode: "ultra" });
    expect(manual.c.setBatteryLow(true)).toBeNull();
    expect(manual.c.tier).toBe("ultra");
  });

  it("setMode emituje zdarzenie onChange", () => {
    const { c } = make();
    const seen: string[] = [];
    c.onChange((x) => seen.push(`${x.from}>${x.to}:${x.reason}`));
    c.setMode("flat");
    expect(seen).toEqual(["high>flat:manual"]);
  });
});

describe("computeFrameStats", () => {
  it("liczy kwantyle i fps", () => {
    const s = computeFrameStats(Array.from({ length: 100 }, (_, i) => (i < 95 ? 16 : 40)));
    expect(s.p50).toBe(16);
    expect(s.p95).toBe(40);
    expect(s.samples).toBe(100);
    expect(computeFrameStats([]).samples).toBe(0);
  });
});
