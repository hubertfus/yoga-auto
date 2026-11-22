/**
 * Współrzędne świata gry → lon/lat (S8). Czysta matematyka, bez zależności.
 *
 * Model: świat gry jest (publicznie opisywaną w społeczności ETS2) konforemną projekcją stożkową Lamberta
 * pomniejszoną o stały współczynnik; x = wschód, z = południe (metry gry), y = wysokość.
 * NIE kopiujemy kodu ani stałych z truckermudgeon/maps (GPL) — poniższe wartości to DOMYŚLNE, NIEZWERYFIKOWANE
 * przybliżenie. Dokładność zapewnia kalibracja (`fitCalibration`) z kotwic (para: x,z gry ↔ lon,lat),
 * które użytkownik wyciąga z danych wygenerowanych przez `map:build` (tools/map/README.md).
 */

const DEG = Math.PI / 180;

export interface LccParams {
  /** promień sfery, m */
  radius: number;
  /** równoleżniki standardowe, stopnie */
  phi1: number;
  phi2: number;
  /** początek układu (szerokość, długość), stopnie */
  phi0: number;
  lambda0: number;
}

/** Domyślne parametry LCC (niezweryfikowane; patrz nagłówek). */
export const DEFAULT_LCC: LccParams = { radius: 6_371_000, phi1: 37, phi2: 65, phi0: 50, lambda0: 15 };

/** Podobieństwo na płaszczyźnie rzutu: P = a·w + b, liczby zespolone (w = x + i·(−z) w metrach gry). */
export interface Calibration {
  a: { re: number; im: number };
  b: { re: number; im: number };
}

/** Domyślnie: skala 19 (1 m gry = 19 m rzeczywistych), bez obrotu i przesunięcia. */
export const DEFAULT_CALIBRATION: Calibration = { a: { re: 19, im: 0 }, b: { re: 0, im: 0 } };

export interface ProjectionConfig {
  lcc: LccParams;
  calibration: Calibration;
}

export const DEFAULT_PROJECTION: ProjectionConfig = { lcc: DEFAULT_LCC, calibration: DEFAULT_CALIBRATION };

interface LccConsts {
  n: number;
  F: number;
  rho0: number;
}

function consts(p: LccParams): LccConsts {
  const t = (phi: number) => Math.tan(Math.PI / 4 + (phi * DEG) / 2);
  const n =
    Math.log(Math.cos(p.phi1 * DEG) / Math.cos(p.phi2 * DEG)) / Math.log(t(p.phi2) / t(p.phi1));
  const F = (Math.cos(p.phi1 * DEG) * Math.pow(t(p.phi1), n)) / n;
  const rho0 = p.radius * F / Math.pow(t(p.phi0), n);
  return { n, F, rho0 };
}

/** lon/lat (°) → rzut LCC (m: wschód, północ). */
export function lccForward(lon: number, lat: number, p: LccParams = DEFAULT_LCC): { x: number; y: number } {
  const { n, F, rho0 } = consts(p);
  const rho = (p.radius * F) / Math.pow(Math.tan(Math.PI / 4 + (lat * DEG) / 2), n);
  const theta = n * (lon - p.lambda0) * DEG;
  return { x: rho * Math.sin(theta), y: rho0 - rho * Math.cos(theta) };
}

/** rzut LCC (m) → lon/lat (°). */
export function lccInverse(x: number, y: number, p: LccParams = DEFAULT_LCC): { lon: number; lat: number } {
  const { n, F, rho0 } = consts(p);
  const sign = Math.sign(n) || 1;
  const dy = rho0 - y;
  const rho = sign * Math.hypot(x, dy);
  const theta = Math.atan2(sign * x, sign * dy);
  const lat = (2 * Math.atan(Math.pow((p.radius * F) / rho, 1 / n)) - Math.PI / 2) / DEG;
  return { lon: p.lambda0 + theta / n / DEG, lat };
}

/** Świat gry (x wschód, z południe, m) → lon/lat. */
export function gameToLonLat(
  x: number,
  z: number,
  cfg: ProjectionConfig = DEFAULT_PROJECTION,
): { lon: number; lat: number } {
  const { a, b } = cfg.calibration;
  const wr = x;
  const wi = -z;
  const px = a.re * wr - a.im * wi + b.re;
  const py = a.re * wi + a.im * wr + b.im;
  return lccInverse(px, py, cfg.lcc);
}

/** lon/lat → świat gry (odwrotność `gameToLonLat`). */
export function lonLatToGame(lon: number, lat: number, cfg: ProjectionConfig = DEFAULT_PROJECTION): { x: number; z: number } {
  const { a, b } = cfg.calibration;
  const p = lccForward(lon, lat, cfg.lcc);
  const dr = p.x - b.re;
  const di = p.y - b.im;
  const d = a.re * a.re + a.im * a.im;
  // w = (P − b) / a
  const wr = (dr * a.re + di * a.im) / d;
  const wi = (di * a.re - dr * a.im) / d;
  return { x: wr, z: -wi };
}

/**
 * Kierunek jazdy w stopniach azymutu (0 = północ, rośnie zgodnie z ruchem wskazówek) na mapie lon/lat.
 * `heading` jak w SDK: 0..1, 0 = północ gry, rośnie PRZECIWNIE do ruchu wskazówek.
 * Uwzględnia zbieżność południków (różnica między północą siatki a północą geograficzną), liczoną z dwóch punktów.
 */
export function headingToBearing(x: number, z: number, heading: number, cfg: ProjectionConfig = DEFAULT_PROJECTION): number {
  const gameBearing = (1 - heading) * 2 * Math.PI; // zgodnie z zegarem od północy gry
  const step = 20; // m gry
  const p1 = gameToLonLat(x, z, cfg);
  const p2 = gameToLonLat(x + Math.sin(gameBearing) * step, z - Math.cos(gameBearing) * step, cfg);
  const dLon = (p2.lon - p1.lon) * DEG;
  const lat1 = p1.lat * DEG;
  const lat2 = p2.lat * DEG;
  const yy = Math.sin(dLon) * Math.cos(lat2);
  const xx = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return ((Math.atan2(yy, xx) / DEG) % 360 + 360) % 360;
}

/** Odległość po sferze (m) — do testów dokładności. */
export function haversineM(a: { lon: number; lat: number }, b: { lon: number; lat: number }, R = 6_371_000): number {
  const dLat = (b.lat - a.lat) * DEG;
  const dLon = (b.lon - a.lon) * DEG;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export interface Anchor {
  x: number;
  z: number;
  lon: number;
  lat: number;
}

/**
 * Dopasowanie kalibracji (podobieństwo: skala + obrót + przesunięcie, metoda najmniejszych kwadratów)
 * z ≥ 2 kotwic. Zwraca też RMS błędu w metrach rzeczywistych i w metrach gry.
 */
export function fitCalibration(
  anchors: readonly Anchor[],
  lcc: LccParams = DEFAULT_LCC,
): { calibration: Calibration; rmsRealM: number; rmsGameM: number } {
  if (anchors.length < 2) throw new Error("fitCalibration: potrzeba co najmniej 2 kotwic");
  const w = anchors.map((p) => ({ re: p.x, im: -p.z }));
  const P = anchors.map((p) => {
    const q = lccForward(p.lon, p.lat, lcc);
    return { re: q.x, im: q.y };
  });
  const mean = (v: { re: number; im: number }[]) => ({
    re: v.reduce((s, c) => s + c.re, 0) / v.length,
    im: v.reduce((s, c) => s + c.im, 0) / v.length,
  });
  const wm = mean(w);
  const Pm = mean(P);
  let numRe = 0;
  let numIm = 0;
  let den = 0;
  for (let i = 0; i < w.length; i++) {
    const dw = { re: w[i]!.re - wm.re, im: w[i]!.im - wm.im };
    const dP = { re: P[i]!.re - Pm.re, im: P[i]!.im - Pm.im };
    // conj(dw) · dP
    numRe += dw.re * dP.re + dw.im * dP.im;
    numIm += dw.re * dP.im - dw.im * dP.re;
    den += dw.re * dw.re + dw.im * dw.im;
  }
  if (den === 0) throw new Error("fitCalibration: kotwice w tym samym punkcie");
  const a = { re: numRe / den, im: numIm / den };
  const b = { re: Pm.re - (a.re * wm.re - a.im * wm.im), im: Pm.im - (a.re * wm.im + a.im * wm.re) };
  const calibration: Calibration = { a, b };
  const cfg: ProjectionConfig = { lcc, calibration };
  const errs = anchors.map((p) => haversineM(gameToLonLat(p.x, p.z, cfg), p, lcc.radius));
  const rmsRealM = Math.sqrt(errs.reduce((s, e) => s + e * e, 0) / errs.length);
  return { calibration, rmsRealM, rmsGameM: rmsRealM / Math.hypot(a.re, a.im) };
}

/** Walidacja JSON-a z `/tiles/projection.json` (lub `meta.json#projection`). Zwraca null przy złym kształcie. */
export function parseProjection(raw: unknown): ProjectionConfig | null {
  const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as { lcc?: Partial<LccParams>; calibration?: Partial<Calibration> };
  const l = r.lcc ?? DEFAULT_LCC;
  const c = r.calibration;
  if (!c?.a || !c.b || !num(c.a.re) || !num(c.a.im) || !num(c.b.re) || !num(c.b.im)) return null;
  const lcc = { ...DEFAULT_LCC, ...l };
  if (![lcc.radius, lcc.phi1, lcc.phi2, lcc.phi0, lcc.lambda0].every(num)) return null;
  return { lcc, calibration: { a: c.a as Calibration["a"], b: c.b as Calibration["b"] } };
}
