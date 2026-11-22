/**
 * Wyznaczanie trasy: A* po stanach (węzeł, kierunek) od pozycji ciężarówki do węzłów firmy docelowej,
 * potem polilinia (Douglas–Peucker) i lista manewrów (skręty na rozgałęzieniach, prom, cel).
 * Koszt = czas przejazdu (`dur`), heurystyka = odległość w linii prostej / V_MAX (dopuszczalna dla dróg).
 */
import { cumulative, pointAt, type Maneuver, type ManeuverKind } from "@yoga-auto/protocol";
import { EDGE_FERRY, EDGE_ROAD, NODE_CITY, type RouteGraph } from "./graph.ts";

/** m/s — najszybsza droga w grze (heurystyka A*) */
const V_MAX = 130 / 3.6;
/** promień szukania węzłów startowych, m */
const START_RADIUS = 250;
/** kara (s) za start „pod prąd” względem kierunku jazdy ciężarówki */
const WRONG_WAY_PENALTY = 600;

export interface Pose {
  x: number;
  z: number;
  /** jak `Placement.heading` z SDK: 0..1, 0 = północ, rośnie przeciwnie do zegara */
  heading: number;
}

export interface PlannedRoute {
  /** kolejne stany (node*2+dir) */
  states: number[];
  /** krawędzie między stanami (indeksy w `to`) */
  edges: number[];
  duration: number;
}

/** Wektor „do przodu” ciężarówki w układzie gry (x wschód, z południe). */
export function forwardOf(heading: number): { fx: number; fz: number } {
  const b = (1 - heading) * 2 * Math.PI;
  return { fx: Math.sin(b), fz: -Math.cos(b) };
}

class MinHeap {
  private keys: number[] = [];
  private vals: number[] = [];
  get size() {
    return this.keys.length;
  }
  push(k: number, v: number) {
    const keys = this.keys;
    const vals = this.vals;
    let i = keys.length;
    keys.push(k);
    vals.push(v);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p]! <= k) break;
      keys[i] = keys[p]!;
      vals[i] = vals[p]!;
      i = p;
    }
    keys[i] = k;
    vals[i] = v;
  }
  pop(): number {
    const keys = this.keys;
    const vals = this.vals;
    const top = vals[0]!;
    const k = keys.pop()!;
    const v = vals.pop()!;
    const n = keys.length;
    if (n) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && keys[r]! < keys[l]! ? r : l;
        if (keys[c]! >= k) break;
        keys[i] = keys[c]!;
        vals[i] = vals[c]!;
        i = c;
      }
      keys[i] = k;
      vals[i] = v;
    }
    return top;
  }
}

/**
 * Stany startowe: rzut ciężarówki na najbliższe krawędzie grafu (odcinek węzeł → sąsiad) zgodne z kierunkiem jazdy.
 * Start = stan na końcu krawędzi, koszt = pozostała część jej czasu przejazdu. Krawędzie „pod prąd” dostają karę
 * (gdy nie ma innych, i tak da się wyznaczyć trasę — np. ciężarówka stoi tyłem na parkingu).
 */
export function startStates(g: RouteGraph, pose: Pose): { state: number; cost: number }[] {
  // daleko od dróg (duży parking, teren firmy, mock) — poszerzamy promień
  for (const r of [START_RADIUS, 1000, 3000]) {
    const out = startStatesWithin(g, pose, r);
    if (out.length) return out;
  }
  return [];
}

function startStatesWithin(g: RouteGraph, pose: Pose, radius: number): { state: number; cost: number }[] {
  const { fx, fz } = forwardOf(pose.heading);
  const cands: { state: number; cost: number; score: number }[] = [];
  for (const { node } of g.grid.near(pose.x, pose.z, radius).slice(0, 40)) {
    const ax = g.x[node]!;
    const az = g.z[node]!;
    for (let dir = 0; dir < 2; dir++) {
      const s = node * 2 + dir;
      for (let e = g.off[s]!; e < g.off[s + 1]!; e++) {
        if (g.flags[e]! & EDGE_FERRY) continue;
        const t = g.to[e]!;
        const dx = g.x[t >> 1]! - ax;
        const dz = g.z[t >> 1]! - az;
        const len2 = dx * dx + dz * dz;
        const len = Math.sqrt(len2) || 1;
        const u = len2 > 0 ? Math.max(0, Math.min(1, ((pose.x - ax) * dx + (pose.z - az) * dz) / len2)) : 0;
        const perp = Math.hypot(pose.x - (ax + u * dx), pose.z - (az + u * dz));
        const cos = (dx * fx + dz * fz) / len;
        const score = perp + (cos < 0.3 ? 80 : 0);
        cands.push({ state: t, cost: (1 - u) * g.dur[e]! + (cos < 0.3 ? WRONG_WAY_PENALTY : 0) + perp / 5, score });
      }
    }
  }
  if (!cands.length) return [];
  cands.sort((a, b) => a.score - b.score);
  // najlepsza krawędź + równoległe (inne pasy tej samej drogi) w zasięgu kilkunastu metrów
  const best = cands[0]!.score;
  const out = new Map<number, number>();
  for (const c of cands) {
    if (c.score > best + 15 || out.size >= 6) break;
    out.set(c.state, Math.min(out.get(c.state) ?? Infinity, c.cost));
  }
  return [...out].map(([state, cost]) => ({ state, cost }));
}

/** A*. `goals` = indeksy węzłów (dowolny kierunek). null = nieosiągalne / brak startu. */
export function planRoute(g: RouteGraph, pose: Pose, goals: readonly number[], maxExpanded = 3_000_000): PlannedRoute | null {
  if (!goals.length) return null;
  const starts = startStates(g, pose);
  if (!starts.length) return null;
  const goalSet = new Set(goals);
  // heurystyka do najbliższego celu (zwykle 1–3 węzły firmy, obok siebie)
  const gx = goals.reduce((s, n) => s + g.x[n]!, 0) / goals.length;
  const gz = goals.reduce((s, n) => s + g.z[n]!, 0) / goals.length;
  const slack = Math.max(...goals.map((n) => Math.hypot(g.x[n]! - gx, g.z[n]! - gz)));
  const h = (node: number) => Math.max(0, Math.hypot(g.x[node]! - gx, g.z[node]! - gz) - slack) / V_MAX;

  const S = g.n * 2;
  const cost = new Float64Array(S).fill(Infinity);
  const via = new Int32Array(S).fill(-1); // krawędź, którą przyszliśmy
  const closed = new Uint8Array(S);
  const heap = new MinHeap();
  for (const st of starts) {
    if (st.cost < cost[st.state]!) {
      cost[st.state] = st.cost;
      heap.push(st.cost + h(st.state >> 1), st.state);
    }
  }
  // poprzednik krawędzi = stan, z którego wychodzi; szukamy go przez `from`
  const from = new Int32Array(S).fill(-1);
  let expanded = 0;
  while (heap.size) {
    const s = heap.pop();
    if (closed[s]) continue;
    closed[s] = 1;
    if (goalSet.has(s >> 1)) return unwind(s, via, from, cost[s]!);
    if (++expanded > maxExpanded) return null;
    const cs = cost[s]!;
    for (let e = g.off[s]!; e < g.off[s + 1]!; e++) {
      const t = g.to[e]!;
      if (closed[t]) continue;
      const c = cs + g.dur[e]!;
      if (c < cost[t]!) {
        cost[t] = c;
        via[t] = e;
        from[t] = s;
        heap.push(c + h(t >> 1), t);
      }
    }
  }
  return null;
}

function unwind(goal: number, via: Int32Array, from: Int32Array, duration: number): PlannedRoute {
  const states = [goal];
  const edges: number[] = [];
  let s = goal;
  while (from[s]! >= 0) {
    edges.push(via[s]!);
    s = from[s]!;
    states.push(s);
  }
  states.reverse();
  edges.reverse();
  return { states, edges, duration };
}

// ─── geometria i manewry ───

/** Douglas–Peucker na płaskiej tablicy [x, z, …]; zachowuje punkty o indeksach z `keep`. */
export function simplify(points: number[], tol: number, keep: ReadonlySet<number> = new Set()): { points: number[]; map: Int32Array } {
  const n = points.length >> 1;
  const mark = new Uint8Array(n);
  if (n) {
    mark[0] = 1;
    mark[n - 1] = 1;
  }
  for (const k of keep) if (k >= 0 && k < n) mark[k] = 1;
  const stack: [number, number][] = [];
  // dziel na odcinki między punktami obowiązkowymi
  let prev = 0;
  for (let i = 1; i < n; i++)
    if (mark[i]) {
      stack.push([prev, i]);
      prev = i;
    }
  while (stack.length) {
    const [a, b] = stack.pop()!;
    if (b - a < 2) continue;
    const ax = points[2 * a]!;
    const az = points[2 * a + 1]!;
    const dx = points[2 * b]! - ax;
    const dz = points[2 * b + 1]! - az;
    const len = Math.hypot(dx, dz);
    let worst = -1;
    let wd = tol;
    for (let i = a + 1; i < b; i++) {
      const px = points[2 * i]! - ax;
      const pz = points[2 * i + 1]! - az;
      const d = len > 0 ? Math.abs(px * dz - pz * dx) / len : Math.hypot(px, pz);
      if (d > wd) {
        wd = d;
        worst = i;
      }
    }
    if (worst >= 0) {
      mark[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  const out: number[] = [];
  const map = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++)
    if (mark[i]) {
      map[i] = out.length >> 1;
      out.push(points[2 * i]!, points[2 * i + 1]!);
    }
  return { points: out, map };
}

const DEG = 180 / Math.PI;

/** Kąt (°, + = w prawo) między kierunkami a→b i b→c w układzie gry (z na południe). */
export function turnAngle(ax: number, az: number, bx: number, bz: number, cx: number, cz: number): number {
  const h1 = Math.atan2(bz - az, bx - ax);
  const h2 = Math.atan2(cz - bz, cx - bx);
  let d = (h2 - h1) * DEG;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  // oś z rośnie na południe: dodatni kąt atan2 to obrót zgodny z zegarem patrząc z góry = w prawo
  return d;
}

export function classifyTurn(angle: number, fork: boolean): ManeuverKind {
  const a = Math.abs(angle);
  const right = angle > 0;
  if (a >= 150) return "uturn";
  if (a >= 110) return right ? "sharpRight" : "sharpLeft";
  if (a >= 50) return right ? "right" : "left";
  if (a >= 22) return right ? "slightRight" : "slightLeft";
  if (fork && a >= 10) return right ? "keepRight" : "keepLeft";
  return "straight";
}

/** Czy ze stanu da się wyjechać więcej niż jedną drogą (rozgałęzienie/skrzyżowanie)? */
function isDecision(g: RouteGraph, state: number): boolean {
  const n = g.off[state + 1]! - g.off[state]!;
  return n >= 2;
}

/**
 * Punkty pośrednie krzywej drogi między węzłami a → b (bez końców). Styczne z obrotów węzłów, skierowane
 * zgodnie z cięciwą, długość = cięciwa (jak splajny dróg SCS). Prawie prosto → nic nie dodaje.
 */
export function hermite(g: RouteGraph, a: number, b: number, out: number[]): void {
  const ra = g.rot[a]!;
  const rb = g.rot[b]!;
  if (!Number.isFinite(ra) || !Number.isFinite(rb)) return;
  const x0 = g.x[a]!;
  const z0 = g.z[a]!;
  const x1 = g.x[b]!;
  const z1 = g.z[b]!;
  const dx = x1 - x0;
  const dz = z1 - z0;
  const L = Math.hypot(dx, dz);
  if (L < 8) return;
  let t0x = Math.cos(ra);
  let t0z = Math.sin(ra);
  if (t0x * dx + t0z * dz < 0) {
    t0x = -t0x;
    t0z = -t0z;
  }
  let t1x = Math.cos(rb);
  let t1z = Math.sin(rb);
  if (t1x * dx + t1z * dz < 0) {
    t1x = -t1x;
    t1z = -t1z;
  }
  const c0 = (t0x * dx + t0z * dz) / L;
  const c1 = (t1x * dx + t1z * dz) / L;
  if (c0 > 0.9995 && c1 > 0.9995) return; // prosto
  const k = Math.max(2, Math.min(24, Math.ceil(L / 15)));
  for (let j = 1; j < k; j++) {
    const t = j / k;
    const t2 = t * t;
    const t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;
    out.push(h00 * x0 + h10 * L * t0x + h01 * x1 + h11 * L * t1x, h00 * z0 + h10 * L * t0z + h01 * z1 + h11 * L * t1z);
  }
}

export interface BuiltRoute {
  points: number[];
  /** pary [i0, i1] segmentów w mieście (indeksy w `points`) */
  city: number[];
  length: number;
  duration: number;
  maneuvers: Maneuver[];
}

/** Okno pomiaru kąta skrętu przed/za skrzyżowaniem (m). */
const TURN_WINDOW = 35;

export function buildRoute(g: RouteGraph, plan: PlannedRoute, pose?: Pose): BuiltRoute {
  // pełna polilinia przez węzły (z pozycją ciężarówki na początku)
  const raw: number[] = [];
  const rawCity: number[] = []; // per punkt: 1 = w mieście
  if (pose) {
    raw.push(pose.x, pose.z);
    rawCity.push(plan.states.length ? g.nodeFlags[plan.states[0]! >> 1]! & NODE_CITY : 0);
  }
  const nodeAt: number[] = []; // indeks punktu dla stanu i
  for (let si = 0; si < plan.states.length; si++) {
    const node = plan.states[si]! >> 1;
    const x = g.x[node]!;
    const z = g.z[node]!;
    // odcinek drogi z poprzedniego węzła: krzywa Hermite'a jak w grze (zamiast cięciwy ścinającej zakręty)
    if (si > 0 && g.flags[plan.edges[si - 1]!]! & EDGE_ROAD) {
      const prev = plan.states[si - 1]! >> 1;
      const before = raw.length;
      hermite(g, prev, node, raw);
      for (let k = before; k < raw.length; k += 2) rawCity.push(g.nodeFlags[prev]! & NODE_CITY);
    }
    const n = raw.length >> 1;
    if (n && raw[2 * n - 2] === x && raw[2 * n - 1] === z) {
      nodeAt.push(n - 1);
      continue;
    }
    nodeAt.push(n);
    raw.push(x, z);
    rawCity.push(g.nodeFlags[node]! & NODE_CITY);
  }
  const rawCum = cumulative(raw);

  // kandydaci na manewry: wyjście ze stanu i krawędzią edges[i]
  type Cand = { at: number; angle: number; fork: boolean; ferry: boolean; side?: number };
  const cands: Cand[] = [];
  for (let i = 0; i + 1 < plan.states.length; i++) {
    const e = plan.edges[i]!;
    const ferry = (g.flags[e]! & EDGE_FERRY) !== 0;
    const prevFerry = i > 0 && (g.flags[plan.edges[i - 1]!]! & EDGE_FERRY) !== 0;
    const at = rawCum[nodeAt[i]!]!;
    if (ferry && !prevFerry) {
      cands.push({ at, angle: 0, fork: false, ferry: true });
      continue;
    }
    if (ferry || !isDecision(g, plan.states[i]!)) continue;
    // przejazd przez skrzyżowanie (prefab) = wiele krawędzi nie-drogowych; kąt mierzymy od wjazdu do wyjazdu
    // j = indeks stanu po ostatniej krawędzi nie-drogowej (wyjazd ze skrzyżowania); = i, gdy edges[i] to droga
    let j = i;
    while (j < plan.edges.length && (g.flags[plan.edges[j]!]! & EDGE_ROAD) === 0) j++;
    const exitAt = rawCum[nodeAt[j]!]!;
    const a = pointAt(raw, rawCum, at - TURN_WINDOW);
    const b = pointAt(raw, rawCum, at);
    const b2 = pointAt(raw, rawCum, exitAt);
    const c = pointAt(raw, rawCum, exitAt + TURN_WINDOW);
    // kierunek wyjazdu: odcinek za skrzyżowaniem; przy końcu trasy — ostatni kawałek przed wyjazdem
    let ox = c.x - b2.x;
    let oz = c.z - b2.z;
    if (Math.hypot(ox, oz) < 5) {
      const p = pointAt(raw, rawCum, Math.max(at, exitAt - TURN_WINDOW));
      ox = b2.x - p.x;
      oz = b2.z - p.z;
    }
    if (Math.hypot(ox, oz) < 1) continue;
    const angle = turnAngle(a.x, a.z, b.x, b.z, b.x + ox, b.z + oz);
    // porównanie z innymi wyjazdami (cięciwa węzeł → następny węzeł każdej odnogi)
    const s = plan.states[i]!;
    const node = s >> 1;
    const rel = (edge: number) => {
      const t = g.to[edge]! >> 1;
      return turnAngle(a.x, a.z, g.x[node]!, g.z[node]!, g.x[t]!, g.z[t]!);
    };
    const mine = rel(e);
    let straightest = mine;
    for (let k = g.off[s]!; k < g.off[s + 1]!; k++) {
      const r = rel(k);
      if (Math.abs(r) < Math.abs(straightest)) straightest = r;
    }
    const onMain = Math.abs(mine) <= Math.abs(straightest) + 3;
    // jedziemy główną (najprostszą) odnogą, a droga tylko łagodnie skręca → bez komunikatu
    if (onMain && Math.abs(angle) < 35) continue;
    cands.push({ at, angle, fork: !onMain, ferry: false, side: mine - straightest });
  }

  // klasyfikacja + scalanie bliskich (to samo skrzyżowanie widziane z kilku węzłów)
  const maneuvers: Maneuver[] = [];
  for (const c of cands) {
    let kind: ManeuverKind = c.ferry ? "ferry" : classifyTurn(c.angle, c.fork);
    // zjazd z głównej drogi pod małym kątem: strona względem najprostszej odnogi
    if (kind === "straight" && c.fork) kind = (c.side ?? 0) >= 0 ? "keepRight" : "keepLeft";
    if (kind === "straight") continue;
    const last = maneuvers.at(-1);
    if (last && c.at - last.at < 25 && last.kind !== "ferry" && kind !== "ferry") {
      if (Math.abs(c.angle) > Math.abs(last.angle)) {
        last.kind = kind;
        last.angle = Math.round(c.angle);
      }
      continue;
    }
    maneuvers.push({ at: c.at, kind, angle: Math.round(c.angle) });
  }
  const total = rawCum[rawCum.length - 1] ?? 0;
  maneuvers.push({ at: total, kind: "arrive", angle: 0 });

  // uproszczenie geometrii (2 m) z zachowaniem granic miast; dystanse manewrów z pełnej geometrii (różnica < 0,1 %)
  const keep = new Set<number>();
  for (let i = 1; i < rawCity.length; i++) if (rawCity[i] !== rawCity[i - 1]) keep.add(i).add(i - 1);
  const simp = simplify(raw, 2, keep);
  const city: number[] = [];
  let runStart = -1;
  let j = 0; // indeks w uproszczonej
  for (let i = 0; i < rawCity.length; i++) {
    const k = simp.map[i]!;
    if (k < 0) continue;
    j = k;
    const c = rawCity[i] === 1;
    if (c && runStart < 0) runStart = j;
    if (!c && runStart >= 0) {
      city.push(runStart, j);
      runStart = -1;
    }
  }
  if (runStart >= 0 && j > runStart) city.push(runStart, j);
  return {
    points: simp.points.map((v) => Math.round(v * 10) / 10),
    city,
    length: total,
    duration: plan.duration,
    maneuvers: maneuvers.map((m) => ({ ...m, at: Math.round(m.at) })),
  };
}
