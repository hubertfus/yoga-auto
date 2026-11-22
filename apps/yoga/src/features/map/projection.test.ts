import { describe, expect, it } from "vitest";
import {
  DEFAULT_LCC,
  DEFAULT_PROJECTION,
  fitCalibration,
  gameToLonLat,
  haversineM,
  headingToBearing,
  lccForward,
  lccInverse,
  lonLatToGame,
  parseProjection,
  type Anchor,
  type ProjectionConfig,
} from "./projection.ts";

describe("LCC", () => {
  it("początek układu → (0,0)", () => {
    const p = lccForward(DEFAULT_LCC.lambda0, DEFAULT_LCC.phi0);
    expect(Math.abs(p.x)).toBeLessThan(1e-6);
    expect(Math.abs(p.y)).toBeLessThan(1e-6);
  });

  it("round-trip lon/lat → rzut → lon/lat (< 1 cm) dla miast Europy", () => {
    const cities = [
      [2.35, 48.86], // Paryż
      [13.4, 52.52], // Berlin
      [-0.13, 51.51], // Londyn
      [12.5, 41.9], // Rzym
      [18.65, 54.35], // Gdańsk
      [24.1, 56.95], // Ryga
    ] as const;
    for (const [lon, lat] of cities) {
      const q = lccForward(lon, lat);
      const back = lccInverse(q.x, q.y);
      expect(haversineM(back, { lon, lat })).toBeLessThan(0.01);
    }
  });

  it("północ geograficzna leży na dodatniej osi y; na wschodzie x > 0", () => {
    expect(lccForward(15, 60).y).toBeGreaterThan(0);
    expect(lccForward(25, 50).x).toBeGreaterThan(0);
  });
});

describe("gameToLonLat", () => {
  it("(0,0) → początek układu; z rośnie na południe", () => {
    const o = gameToLonLat(0, 0);
    expect(o.lon).toBeCloseTo(15, 6);
    expect(o.lat).toBeCloseTo(50, 6);
    expect(gameToLonLat(0, 1000).lat).toBeLessThan(o.lat);
    expect(gameToLonLat(1000, 0).lon).toBeGreaterThan(o.lon);
  });

  it("1 km gry ≈ 19 km rzeczywistych (skala domyślna)", () => {
    const d = haversineM(gameToLonLat(0, 0), gameToLonLat(1000, 0));
    expect(d / 1000).toBeGreaterThan(18.5);
    expect(d / 1000).toBeLessThan(20); // LCC ma lokalne zniekształcenie skali ~3% przy 50°N
  });

  it("round-trip gra → lon/lat → gra (< 1 mm gry)", () => {
    for (const [x, z] of [[0, 0], [-31000, -5500], [20000, 12000], [1234.5, -9876.5]] as const) {
      const ll = gameToLonLat(x, z);
      const back = lonLatToGame(ll.lon, ll.lat);
      expect(Math.hypot(back.x - x, back.z - z)).toBeLessThan(1e-3);
    }
  });
});

describe("kalibracja kotwicami", () => {
  // „prawdziwa” projekcja gry: skala 18.7, obrót 0.8°, przesunięcie — inna niż domyślna
  const rot = (0.8 * Math.PI) / 180;
  const truth: ProjectionConfig = {
    lcc: DEFAULT_LCC,
    calibration: { a: { re: 18.7 * Math.cos(rot), im: 18.7 * Math.sin(rot) }, b: { re: -310_000, im: 85_000 } },
  };
  const pts = [[-31000, -5500], [12000, -9000], [2000, 14000], [25000, 3000], [-8000, 8000]] as const;
  const anchors: Anchor[] = pts.map(([x, z]) => ({ x, z, ...gameToLonLat(x, z, truth) }));

  it("odtwarza skalę/obrót/przesunięcie z 5 kotwic bez szumu", () => {
    const fit = fitCalibration(anchors);
    expect(fit.rmsRealM).toBeLessThan(0.01);
    expect(fit.calibration.a.re).toBeCloseTo(truth.calibration.a.re, 6);
    expect(fit.calibration.a.im).toBeCloseTo(truth.calibration.a.im, 6);
    const cfg = { lcc: DEFAULT_LCC, calibration: fit.calibration };
    // punkt spoza kotwic: błąd w metrach gry < 0.1 (wymóg DoD: < 20 m)
    const g = [5000, -2500] as const;
    const exp = gameToLonLat(g[0], g[1], truth);
    expect(haversineM(gameToLonLat(g[0], g[1], cfg), exp) / 18.7).toBeLessThan(0.1);
  });

  it("szum kotwic ±30 m rzecz. daje RMS rzędu szumu, a błąd w grze < 20 m", () => {
    const noisy = anchors.map((a, i) => ({ ...a, lon: a.lon + (i % 2 ? 1 : -1) * 3e-4, lat: a.lat + (i % 3 ? 1 : -1) * 2e-4 }));
    const fit = fitCalibration(noisy);
    expect(fit.rmsGameM).toBeLessThan(20);
  });

  it("wymaga ≥ 2 kotwic", () => {
    expect(() => fitCalibration([anchors[0]!])).toThrow();
  });
});

describe("headingToBearing", () => {
  it("na południku osiowym: heading 0 → 0°, 0.25 (zachód) → 270°, 0.5 → 180°", () => {
    expect(headingToBearing(0, 0, 0)).toBeCloseTo(0, 3);
    expect(headingToBearing(0, 0, 0.25)).toBeCloseTo(270, 1);
    expect(headingToBearing(0, 0, 0.5)).toBeCloseTo(180, 2);
    expect(headingToBearing(0, 0, 0.75)).toBeCloseTo(90, 1);
  });

  it("na wschód od południka osiowego północ siatki ≠ północ geograficzna (zbieżność ≈ n·Δλ)", () => {
    // x ≈ +600 km rzecz. ≈ 31 600 m gry na wschód od λ0
    const b = headingToBearing(31_600, 0, 0);
    expect(b).toBeGreaterThan(3);
    expect(b).toBeLessThan(15);
  });
});

describe("parseProjection", () => {
  it("przyjmuje poprawny JSON i odrzuca śmieci", () => {
    expect(parseProjection(DEFAULT_PROJECTION)).not.toBeNull();
    expect(parseProjection({ calibration: { a: { re: 1 } } })).toBeNull();
    expect(parseProjection(null)).toBeNull();
    expect(parseProjection({ calibration: DEFAULT_PROJECTION.calibration, lcc: { phi1: "x" } })).toBeNull();
  });
});
