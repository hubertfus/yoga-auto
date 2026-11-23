/**
 * Ścieżki przejazdu przez prefaby (skrzyżowania, ronda, zjazdy, wjazdy do firm) dla grafu trasy.
 *
 * Graf truckermudgeon łączy węzeł wjazdu prefabu z węzłem wyjazdu jedną krawędzią — bez geometrii, więc trasa
 * rysowana cięciwą ścina skrzyżowania i ma ostre załamania. Opis prefabu (`prefabDescriptions`) ma krzywe
 * nawigacyjne AI (`navCurves`: odcinki Hermite'a w układzie lokalnym prefabu, z `nextLines`), a węzły opisu
 * mówią, które krzywe zaczynają się (`inputLanes`) i kończą (`outputLanes`) w danym węźle.
 *
 * Kroki: (1) dopasowanie układu lokalnego do świata po węzłach prefabu (obrót + przesunięcie, ewentualnie
 * odbicie; przyporządkowanie węzłów cykliczne — wybieramy wariant o najmniejszym błędzie), (2) najkrótszy
 * ciąg krzywych od pasów wjazdu do pasów wyjazdu, (3) próbkowanie krzywych, przeniesienie do świata,
 * „przyklejenie” końców do węzłów (krzywe biegną środkiem pasa, trasa po drogach — osią) i uproszczenie.
 */

export interface DescNode {
  x: number;
  y: number;
  rotation: number;
  inputLanes: number[];
  outputLanes: number[];
}
export interface NavPoint {
  x: number;
  y: number;
  rotation: number;
}
export interface NavCurve {
  start: NavPoint;
  end: NavPoint;
  nextLines: number[];
}
export interface PrefabDesc {
  token: string;
  nodes: DescNode[];
  navCurves: NavCurve[];
}

/** Dopasowanie prefabu: węzeł świata i (kolejność `nodeUids`) ↔ węzeł opisu perm[i]; local → świat. */
export interface PrefabFit {
  perm: number[];
  mirror: boolean;
  cos: number;
  sin: number;
  tx: number;
  tz: number;
  /** maks. odchyłka węzłów po dopasowaniu (m) */
  err: number;
}

/** maks. błąd dopasowania węzłów prefabu (m) */
export const FIT_MAX_ERR = 2;
/** maks. odległość początku/końca ścieżki od węzła (m) — dalej uznajemy, że to nie ta ścieżka */
export const SNAP_MAX = 14;

export function toWorld(f: PrefabFit, x: number, y: number): [number, number] {
  const ly = f.mirror ? -y : y;
  return [f.cos * x - f.sin * ly + f.tx, f.sin * x + f.cos * ly + f.tz];
}

/**
 * Dopasowuje układ lokalny opisu do pozycji węzłów w świecie (≥ 2 węzły). Prefaby symetryczne pasują w kilku
 * ustawieniach — remis (do 5 cm) rozstrzyga konwencja gry: węzeł świata 0 = węzeł opisu `origin`, bez odbicia.
 */
export function fitPrefab(desc: PrefabDesc, world: readonly { x: number; z: number }[], origin = 0): PrefabFit | null {
  const n = desc.nodes.length;
  if (n < 2 || world.length !== n) return null;
  let best: PrefabFit | null = null;
  for (const mirror of [false, true])
    for (const reverse of [false, true])
      for (let s = 0; s < n; s++) {
        const perm = world.map((_, i) => (reverse ? (s - i + n) % n : (i + s) % n));
        const L = perm.map((k) => ({ x: desc.nodes[k]!.x, y: mirror ? -desc.nodes[k]!.y : desc.nodes[k]!.y }));
        // para węzłów o największym rozstawie (stabilny kąt)
        let a = 0;
        let b = 1;
        let far = -1;
        for (let i = 0; i < n; i++)
          for (let j = i + 1; j < n; j++) {
            const d = Math.hypot(world[j]!.x - world[i]!.x, world[j]!.z - world[i]!.z);
            if (d > far) [far, a, b] = [d, i, j];
          }
        if (far < 0.5) continue;
        const th =
          Math.atan2(world[b]!.z - world[a]!.z, world[b]!.x - world[a]!.x) - Math.atan2(L[b]!.y - L[a]!.y, L[b]!.x - L[a]!.x);
        const cos = Math.cos(th);
        const sin = Math.sin(th);
        const tx = world[a]!.x - (cos * L[a]!.x - sin * L[a]!.y);
        const tz = world[a]!.z - (sin * L[a]!.x + cos * L[a]!.y);
        let err = 0;
        for (let i = 0; i < n; i++) {
          const wx = cos * L[i]!.x - sin * L[i]!.y + tx;
          const wz = sin * L[i]!.x + cos * L[i]!.y + tz;
          err = Math.max(err, Math.hypot(wx - world[i]!.x, wz - world[i]!.z));
        }
        const cand = { perm, mirror, cos, sin, tx, tz, err };
        if (!best || err < best.err - 0.05 || (err < best.err + 0.05 && rank(cand, origin) < rank(best, origin))) best = cand;
      }
  return best && best.err <= FIT_MAX_ERR ? best : null;
}

/** Preferencja przy remisie: zgodność z `originNodeIndex`, potem brak odbicia, potem mniejszy błąd. */
const rank = (f: PrefabFit, origin: number) => (f.perm[0] === origin ? 0 : 2) + (f.mirror ? 1 : 0) + f.err / 100;

const curveLen = (c: NavCurve) => Math.hypot(c.end.x - c.start.x, c.end.y - c.start.y);

/** Najkrótszy (po długości cięciw) ciąg krzywych od pasów wjazdu węzła `from` do pasów wyjazdu węzła `to`. */
export function curvePath(desc: PrefabDesc, from: number, to: number): number[] | null {
  const starts = desc.nodes[from]?.inputLanes ?? [];
  const goals = new Set(desc.nodes[to]?.outputLanes ?? []);
  if (!starts.length || !goals.size) return null;
  const C = desc.navCurves;
  const dist = new Map<number, number>();
  const prev = new Map<number, number>();
  const open: number[] = [];
  for (const s of starts)
    if (C[s]) {
      dist.set(s, curveLen(C[s]!));
      open.push(s);
    }
  // mała liczba krzywych → prosta Dijkstra z liniowym wyborem minimum
  const done = new Set<number>();
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (dist.get(open[i]!)! < dist.get(open[bi]!)!) bi = i;
    const c = open.splice(bi, 1)[0]!;
    if (done.has(c)) continue;
    done.add(c);
    if (goals.has(c)) {
      const path = [c];
      while (prev.has(path[0]!)) path.unshift(prev.get(path[0]!)!);
      return path;
    }
    for (const nx of C[c]!.nextLines) {
      if (!C[nx] || done.has(nx)) continue;
      const d = dist.get(c)! + curveLen(C[nx]!);
      if (d < (dist.get(nx) ?? Infinity)) {
        dist.set(nx, d);
        prev.set(nx, c);
        open.push(nx);
      }
    }
  }
  return null;
}

/** Punkty ciągu krzywych w układzie lokalnym (Hermite, styczne z obrotów, długość = cięciwa), z końcami. */
export function sampleCurves(desc: PrefabDesc, path: readonly number[]): number[] {
  const out: number[] = [];
  const push = (x: number, y: number) => {
    const n = out.length;
    if (n >= 2 && Math.abs(out[n - 2]! - x) < 0.05 && Math.abs(out[n - 1]! - y) < 0.05) return;
    out.push(x, y);
  };
  for (const ci of path) {
    const c = desc.navCurves[ci]!;
    const { start: a, end: b } = c;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const L = Math.hypot(dx, dy);
    push(a.x, a.y);
    if (L < 0.5) continue;
    let t0x = Math.cos(a.rotation);
    let t0y = Math.sin(a.rotation);
    if (t0x * dx + t0y * dy < 0) [t0x, t0y] = [-t0x, -t0y];
    let t1x = Math.cos(b.rotation);
    let t1y = Math.sin(b.rotation);
    if (t1x * dx + t1y * dy < 0) [t1x, t1y] = [-t1x, -t1y];
    const k = Math.max(1, Math.min(16, Math.ceil(L / 3)));
    for (let j = 1; j < k; j++) {
      const t = j / k;
      const t2 = t * t;
      const t3 = t2 * t;
      const h00 = 2 * t3 - 3 * t2 + 1;
      const h10 = t3 - 2 * t2 + t;
      const h01 = -2 * t3 + 3 * t2;
      const h11 = t3 - t2;
      push(h00 * a.x + h10 * L * t0x + h01 * b.x + h11 * L * t1x, h00 * a.y + h10 * L * t0y + h01 * b.y + h11 * L * t1y);
    }
    push(b.x, b.y);
  }
  return out;
}

/** Douglas–Peucker na płaskiej tablicy [x, z, …] (zachowuje końce). */
export function simplifyFlat(pts: readonly number[], tol: number): number[] {
  const n = pts.length >> 1;
  if (n <= 2) return [...pts];
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [i0, i1] = stack.pop()!;
    const ax = pts[2 * i0]!;
    const az = pts[2 * i0 + 1]!;
    const bx = pts[2 * i1]!;
    const bz = pts[2 * i1 + 1]!;
    const dx = bx - ax;
    const dz = bz - az;
    const L2 = dx * dx + dz * dz;
    let worst = -1;
    let wd = tol;
    for (let i = i0 + 1; i < i1; i++) {
      const px = pts[2 * i]! - ax;
      const pz = pts[2 * i + 1]! - az;
      const t = L2 > 0 ? Math.max(0, Math.min(1, (px * dx + pz * dz) / L2)) : 0;
      const d = Math.hypot(px - t * dx, pz - t * dz);
      if (d > wd) [wd, worst] = [d, i];
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push([i0, worst], [worst, i1]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[2 * i]!, pts[2 * i + 1]!);
  return out;
}

/**
 * Środek pasów wjazdu (węzeł `from`) i wyjazdu (węzeł `to`), którymi da się przejechać z `from` do `to`
 * (lokalnie). Na wielopasowej jezdni to środek jezdni w kierunku jazdy — trasa nie skacze między pasami.
 */
export function laneCenters(desc: PrefabDesc, from: number, to: number): { s: [number, number]; e: [number, number] } | null {
  const C = desc.navCurves;
  const ins = (desc.nodes[from]?.inputLanes ?? []).filter((c) => C[c]);
  const outs = (desc.nodes[to]?.outputLanes ?? []).filter((c) => C[c]);
  // osiągalne do przodu z wjazdów i wstecz z wyjazdów
  const reach = (seeds: number[], step: (c: number) => readonly number[]): Set<number> => {
    const seen = new Set(seeds);
    const q = [...seeds];
    while (q.length) {
      for (const nx of step(q.pop()!)) {
        if (C[nx] && !seen.has(nx)) {
          seen.add(nx);
          q.push(nx);
        }
      }
    }
    return seen;
  };
  const prev = new Map<number, number[]>();
  C.forEach((c, i) => {
    for (const nx of c.nextLines) {
      const l = prev.get(nx);
      if (l) l.push(i);
      else prev.set(nx, [i]);
    }
  });
  const fwd = reach(ins, (c) => C[c]!.nextLines);
  const back = reach(outs, (c) => prev.get(c) ?? []);
  const si = ins.filter((c) => back.has(c));
  const eo = outs.filter((c) => fwd.has(c));
  if (!si.length || !eo.length) return null;
  const mean = (list: number[], end: boolean): [number, number] => {
    let x = 0;
    let y = 0;
    for (const c of list) {
      const p = end ? C[c]!.end : C[c]!.start;
      x += p.x;
      y += p.y;
    }
    return [x / list.length, y / list.length];
  };
  return { s: mean(si, false), e: mean(eo, true) };
}

/**
 * Ścieżka w świecie z węzła prefabu `i` do `j` (indeksy w `nodeUids`): pełna polilinia [x, z, …] w kolejności
 * jazdy, z końcami. Kształt z najkrótszego ciągu krzywych, końce przesunięte (liniowo po długości) na środek
 * pasów przejezdnych — leżą obok węzłów, o odległość jezdni od osi drogi; planner wyrównuje do nich drogi.
 * null, gdy nie da się jej wyznaczyć wiarygodnie (końce dalej niż SNAP_MAX od węzłów).
 */
export function prefabEdgePath(
  desc: PrefabDesc,
  fit: PrefabFit,
  i: number,
  j: number,
  a: { x: number; z: number },
  b: { x: number; z: number },
  cache?: Map<string, LocalPath | null>,
): number[] | null {
  const di = fit.perm[i]!;
  const dj = fit.perm[j]!;
  const key = `${desc.token}|${di}|${dj}`;
  let local = cache?.get(key);
  if (local === undefined) {
    const path = curvePath(desc, di, dj);
    const pts = path ? sampleCurves(desc, path) : null;
    const lc = pts && pts.length >= 4 ? laneCenters(desc, di, dj) : null;
    local = pts && pts.length >= 4 ? { pts, s: lc?.s ?? [pts[0]!, pts[1]!], e: lc?.e ?? [pts[pts.length - 2]!, pts[pts.length - 1]!] } : null;
    cache?.set(key, local);
  }
  if (!local) return null;
  const w: number[] = [];
  for (let k = 0; k < local.pts.length; k += 2) w.push(...toWorld(fit, local.pts[k]!, local.pts[k + 1]!));
  const n = w.length >> 1;
  const [sx, sz] = toWorld(fit, local.s[0], local.s[1]);
  const [ex, ez] = toWorld(fit, local.e[0], local.e[1]);
  if (Math.hypot(a.x - sx, a.z - sz) > SNAP_MAX || Math.hypot(b.x - ex, b.z - ez) > SNAP_MAX) return null;
  // przesunięcie liniowe po długości: początek → środek pasów wjazdu, koniec → środek pasów wyjazdu
  const dsx = sx - w[0]!;
  const dsz = sz - w[1]!;
  const dex = ex - w[2 * n - 2]!;
  const dez = ez - w[2 * n - 1]!;
  const cum = [0];
  for (let k = 1; k < n; k++) cum.push(cum[k - 1]! + Math.hypot(w[2 * k]! - w[2 * k - 2]!, w[2 * k + 1]! - w[2 * k - 1]!));
  const total = cum[n - 1]! || 1;
  for (let k = 0; k < n; k++) {
    const t = cum[k]! / total;
    w[2 * k] = w[2 * k]! + dsx * (1 - t) + dex * t;
    w[2 * k + 1] = w[2 * k + 1]! + dsz * (1 - t) + dez * t;
  }
  return simplifyFlat(w, 0.3).map((v) => Math.round(v * 100) / 100);
}

/** Ścieżka lokalna prefabu (cache po tokenie i parze węzłów): punkty + środki pasów na końcach. */
export interface LocalPath {
  pts: number[];
  s: [number, number];
  e: [number, number];
}
