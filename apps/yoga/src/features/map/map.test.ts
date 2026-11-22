import { describe, expect, it, vi } from "vitest";
import { normalizeBearing, springStep, unwrapAngle } from "./spring.ts";
import { buildStyle, classifyLayer, FALLBACK_COLORS } from "./style.ts";
import { createTierDrop } from "./tierDrop.ts";
import { DEFAULT_PROJECTION } from "./projection.ts";

vi.mock("../../core/client.ts", () => ({ getToken: () => null }));

describe("spring", () => {
  it("zbiega do celu bez oscylacji nadmiernej (smooth: 300/30)", () => {
    let s = { x: 0, v: 0 };
    let maxX = 0;
    for (let i = 0; i < 120; i++) {
      s = springStep(s, 1, 1 / 60, { stiffness: 300, damping: 30 });
      maxX = Math.max(maxX, s.x);
    }
    expect(s.x).toBeCloseTo(1, 3);
    expect(maxX).toBeLessThan(1.03);
  });

  it("jest stabilna przy długiej klatce (dt = 0.1) i sztywnej sprężynie", () => {
    let s = { x: 0, v: 0 };
    for (let i = 0; i < 20; i++) s = springStep(s, 5, 0.1, { stiffness: 520, damping: 34 });
    expect(Number.isFinite(s.x)).toBe(true);
    expect(s.x).toBeCloseTo(5, 2);
  });

  it("unwrapAngle wybiera krótszą drogę przez 0/360", () => {
    expect(unwrapAngle(350, 10)).toBe(370);
    expect(unwrapAngle(10, 350)).toBe(-10);
    expect(unwrapAngle(100, 120)).toBe(120);
    expect(normalizeBearing(-10)).toBe(350);
    expect(normalizeBearing(370)).toBe(10);
  });
});

describe("style", () => {
  it("bez kafli: tylko tło", () => {
    const s = buildStyle(FALLBACK_COLORS, null);
    expect(s.layers.map((l) => l.id)).toEqual(["bg"]);
    expect(Object.keys(s.sources)).toHaveLength(0);
  });

  it("klasyfikuje warstwy po nazwie", () => {
    expect(classifyLayer("water")).toBe("water");
    expect(classifyLayer("motorway")).toBe("road-major");
    expect(classifyLayer("roads")).toBe("road");
    expect(classifyLayer("railways")).toBe("rail");
    expect(classifyLayer("cities")).toBe("area");
  });

  it("z kaflami: źródło pmtiles, powierzchnie przed liniami, kolory jako rgb()", () => {
    const s = buildStyle(FALLBACK_COLORS, { url: "http://x/tiles/europe.pmtiles", layers: ["water", "roads", "areas"] });
    expect(s.sources.europe).toMatchObject({ type: "vector", url: "pmtiles://http://x/tiles/europe.pmtiles" });
    const ids = s.layers.map((l) => l.id);
    expect(ids[0]).toBe("bg");
    expect(ids.indexOf("fill-areas")).toBeLessThan(ids.indexOf("line-roads"));
    expect(ids).not.toContain("fill-roads");
    expect(JSON.stringify(s)).not.toMatch(/oklch/);
  });
});

describe("tierDrop", () => {
  const mk = (current: "ultra" | "high" | "lite" | "flat") => {
    const apply = vi.fn();
    const restore = vi.fn();
    return { apply, restore, drop: createTierDrop({ current: () => current, apply, restore }) };
  };

  it("high → lite na czas gestu, potem przywraca", () => {
    const { apply, restore, drop } = mk("high");
    drop.begin();
    expect(apply).toHaveBeenCalledWith("lite");
    drop.end();
    expect(restore).toHaveBeenCalledTimes(1);
  });

  it("licznik: dwa widoki, przywrócenie dopiero po obu", () => {
    const { apply, restore, drop } = mk("ultra");
    drop.begin();
    drop.begin();
    drop.end();
    expect(restore).not.toHaveBeenCalled();
    drop.end();
    expect(apply).toHaveBeenCalledTimes(1);
    expect(restore).toHaveBeenCalledTimes(1);
  });

  it("nie rusza tieru już niższego niż lite", () => {
    const { apply, restore, drop } = mk("flat");
    drop.begin();
    drop.end();
    expect(apply).not.toHaveBeenCalled();
    expect(restore).not.toHaveBeenCalled();
  });

  it("nadmiarowe end() są ignorowane", () => {
    const { restore, drop } = mk("high");
    drop.end();
    expect(restore).not.toHaveBeenCalled();
  });
});

describe("tiles", () => {
  it("withToken dokleja ?k=", async () => {
    const { withToken, fetchProjection } = await import("./tiles.ts");
    expect(withToken("/tiles/a.pmtiles", "t k")).toBe("/tiles/a.pmtiles?k=t%20k");
    expect(withToken("/tiles/a.pmtiles", null)).toBe("/tiles/a.pmtiles");

    const ok = vi.fn(async () =>
      new Response(JSON.stringify(DEFAULT_PROJECTION), { headers: { "content-type": "application/json" } }),
    );
    expect(await fetchProjection(ok as unknown as typeof fetch, null)).not.toBeNull();
    const html = vi.fn(async () => new Response("<html>", { headers: { "content-type": "text/html" } }));
    expect(await fetchProjection(html as unknown as typeof fetch, null)).toBeNull();
    const boom = vi.fn(async () => {
      throw new Error("net");
    });
    expect(await fetchProjection(boom as unknown as typeof fetch, null)).toBeNull();
  });
});
