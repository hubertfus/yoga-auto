/**
 * Trasa GPS (M4+, addytywnie). SDK gry NIE udostępnia trasy z nawigacji, więc bridge liczy ją sam
 * z grafu dróg (tools/map → `route-graph.bin`) od pozycji ciężarówki do firmy docelowej zlecenia.
 *
 * Bridge wysyła `{ t: "route" }` przy każdej nowej trasie (nowe zlecenie, zjazd z trasy → przeliczenie)
 * i zaraz po połączeniu klienta. Postęp na trasie klient liczy sam z `fast.placement` (`projectOnRoute`).
 */

/** Rodzaj manewru (kąt skrętu: + w prawo, − w lewo). */
export type ManeuverKind =
  | "straight"
  | "keepLeft"
  | "keepRight"
  | "slightLeft"
  | "slightRight"
  | "left"
  | "right"
  | "sharpLeft"
  | "sharpRight"
  | "uturn"
  | "ferry"
  | "arrive";

export interface Maneuver {
  /** m od początku trasy (wzdłuż `points`) */
  at: number;
  kind: ManeuverKind;
  /** stopnie, + = w prawo */
  angle: number;
}

export interface RouteInfo {
  /** zmienia się przy każdym przeliczeniu */
  id: string;
  /** cel trasy: firma docelowa zlecenia albo (gdy `manual`) punkt wybrany na tablecie — wtedy `city` = jego nazwa */
  to: { city: string; company: string };
  /** cel wybrany ręcznie na tablecie (`route.set`), nie ze zlecenia */
  manual?: boolean;
  /** polilinia w metrach świata gry: [x0, z0, x1, z1, …] */
  points: number[];
  /**
   * Odcinki w obszarach miast: pary [i0, i1] (segmenty od punktu i0 do i1). Gra skaluje odległości
   * pokazywane w GPS inaczej w mieście (`CITY_SCALE`) niż poza nim (`WORLD_SCALE`) — patrz `gameCumulative`.
   */
  city: number[];
  /** m świata (wzdłuż `points`); dystans „jak w grze” = `gameCumulative(...)` */
  length: number;
  /** s, szacunek wg typów dróg */
  duration: number;
  maneuvers: Maneuver[];
  /** ms epoch bridge'a */
  computedAt: number;
}

export interface RouteMsg {
  t: "route";
  ts: number;
  /** null = brak trasy (brak zlecenia / brak grafu / cel nieosiągalny) */
  route: RouteInfo | null;
}

/** Cel wybrany na tablecie: punkt w metrach świata gry + nazwa do wyświetlenia. */
export interface RouteTarget {
  x: number;
  z: number;
  label: string;
}

/**
 * UI → bridge: ustaw (albo `target: null` — wyczyść) ręczny cel trasy. Gra nie udostępnia celu z jej GPS,
 * więc bez zlecenia cel wybiera się na tablecie. Odpowiedź: `ack` (ok:false + invalid_value przy złych danych).
 */
export interface RouteSetMsg {
  t: "route.set";
  id: string;
  target: RouteTarget | null;
}

// ─── geometria (wspólna dla bridge i UI) ───

/** Skala odległości gry poza miastami (ETS2 `local.scale`): 1 m świata ≈ 19 m na liczniku/GPS. */
export const WORLD_SCALE = 19;
/** Skala w obszarach miast. */
export const CITY_SCALE = 3;

/** Skumulowany dystans per punkt polilinii (`cum[0] = 0`). */
export function cumulative(points: readonly number[]): Float64Array {
  const n = points.length >> 1;
  const cum = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    cum[i] = cum[i - 1]! + Math.hypot(points[2 * i]! - points[2 * i - 2]!, points[2 * i + 1]! - points[2 * i - 1]!);
  }
  return cum;
}

/** Skumulowany dystans „jak w grze” (z uwzględnieniem skali miasto/trasa) per punkt. */
export function gameCumulative(points: readonly number[], city: readonly number[]): Float64Array {
  const n = points.length >> 1;
  const inCity = new Uint8Array(Math.max(0, n - 1));
  for (let k = 0; k + 1 < city.length; k += 2) for (let i = city[k]!; i < city[k + 1]! && i < n - 1; i++) inCity[i] = 1;
  const cum = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    const d = Math.hypot(points[2 * i]! - points[2 * i - 2]!, points[2 * i + 1]! - points[2 * i - 1]!);
    cum[i] = cum[i - 1]! + d * (inCity[i - 1] ? CITY_SCALE : WORLD_SCALE);
  }
  return cum;
}

/** Interpolacja wartości `to[]` w punkcie `along` na skali `from[]` (np. świat → dystans gry). */
export function remap(from: ArrayLike<number>, to: ArrayLike<number>, along: number): number {
  const n = from.length;
  if (!n) return 0;
  if (along <= from[0]!) return to[0]!;
  if (along >= from[n - 1]!) return to[n - 1]!;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (from[mid]! <= along) lo = mid;
    else hi = mid;
  }
  const seg = from[hi]! - from[lo]!;
  const t = seg > 0 ? (along - from[lo]!) / seg : 0;
  return to[lo]! + t * (to[hi]! - to[lo]!);
}

export interface RouteProjection {
  /** m od początku trasy */
  along: number;
  /** odległość od trasy, m */
  offset: number;
  /** indeks segmentu (punkt początkowy) */
  index: number;
}

/**
 * Rzut punktu (x, z) na polilinię. Gdy podano `hint` (indeks z poprzedniego rzutu), szuka w oknie
 * [hint − back, hint + ahead] segmentów (tanie przy 10 Hz); bez `hint` — po całej trasie.
 */
export function projectOnRoute(
  points: readonly number[],
  cum: ArrayLike<number>,
  x: number,
  z: number,
  hint?: number,
  back = 20,
  ahead = 200,
): RouteProjection | null {
  const n = points.length >> 1;
  if (n < 2) return null;
  const lo = hint === undefined ? 0 : Math.max(0, hint - back);
  const hi = hint === undefined ? n - 2 : Math.min(n - 2, hint + ahead);
  let best: RouteProjection | null = null;
  let bestD = Infinity;
  for (let i = lo; i <= hi; i++) {
    const ax = points[2 * i]!;
    const az = points[2 * i + 1]!;
    const dx = points[2 * i + 2]! - ax;
    const dz = points[2 * i + 3]! - az;
    const len2 = dx * dx + dz * dz;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2)) : 0;
    const px = ax + t * dx;
    const pz = az + t * dz;
    const d = Math.hypot(x - px, z - pz);
    if (d < bestD) {
      bestD = d;
      best = { along: cum[i]! + t * Math.sqrt(len2), offset: d, index: i };
    }
  }
  return best;
}

/** Punkt polilinii w odległości `along` od początku (clamp do końców). */
export function pointAt(points: readonly number[], cum: ArrayLike<number>, along: number): { x: number; z: number } {
  const n = points.length >> 1;
  if (n === 0) return { x: 0, z: 0 };
  if (along <= 0 || n === 1) return { x: points[0]!, z: points[1]! };
  if (along >= cum[n - 1]!) return { x: points[2 * n - 2]!, z: points[2 * n - 1]! };
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid]! <= along) lo = mid;
    else hi = mid;
  }
  const seg = cum[hi]! - cum[lo]!;
  const t = seg > 0 ? (along - cum[lo]!) / seg : 0;
  return {
    x: points[2 * lo]! + t * (points[2 * hi]! - points[2 * lo]!),
    z: points[2 * lo + 1]! + t * (points[2 * hi + 1]! - points[2 * lo + 1]!),
  };
}

/** Pierwszy manewr za pozycją `along` (z marginesem `passed` m na już minięte). */
export function nextManeuverIndex(maneuvers: readonly Maneuver[], along: number, passed = 10): number {
  for (let i = 0; i < maneuvers.length; i++) if (maneuvers[i]!.at > along + passed) return i;
  return -1;
}
