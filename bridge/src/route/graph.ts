/**
 * Graf dróg do wyznaczania trasy (format własny `route-graph.bin`, generowany przez `npm run map:graph`
 * z danych narzędzia truckermudgeon/maps — patrz tools/map/README.md).
 *
 * Model: stan = (węzeł, kierunek jazdy) → indeks `node * 2 + dir` (0 = forward, 1 = backward w nomenklaturze
 * gry). Krawędzie wychodzą ze stanu i prowadzą do stanu (węzeł sąsiada + kierunek, w którym jedzie się dalej).
 *
 * Plik (little-endian):
 *   "YARG" | u32 version=3 | u32 n (węzły) | u32 m (krawędzie) | u32 companiesBytes
 *   f32 x[n] | f32 z[n] | f32 rot[n] | u32 off[2n+1] | u32 to[m] | f32 dist[m] | f32 dur[m] | u8 flags[m] | pad do 4 B
 *   u8 nodeFlags[n] | pad do 4 B | utf8 JSON firm: [[cityToken, companyToken, nodeIndex], …] | pad do 4 B
 *   (v4) u32 P | u32 geomOff[m+1] | f32 geom[2P] — geometria krawędzi (x, z) w kolejności jazdy, z końcami:
 *        przejazdy przez prefaby (skrzyżowania, ronda, zjazdy) środkiem pasa po krzywych nawigacyjnych gry;
 *        końce leżą na pasie (obok węzłów), planner przesuwa do nich drogi.
 * Wersja 3 (bez geometrii) jest nadal czytana.
 */
import { readFileSync } from "node:fs";

export const GRAPH_MAGIC = "YARG";
export const GRAPH_VERSION = 4;

/** krawędź to prom */
export const EDGE_FERRY = 1;
/** krawędź to odcinek drogi (nie przejazd przez skrzyżowanie / prefab) */
export const EDGE_ROAD = 2;
/** węzeł leży w obszarze miasta (inna skala odległości w grze) */
export const NODE_CITY = 1;

export interface RouteGraph {
  n: number;
  x: Float32Array;
  z: Float32Array;
  /** obrót węzła (rad): styczna drogi w węźle = ±(cos rot, sin rot) w układzie (x, z) gry */
  rot: Float32Array;
  /** CSR po stanach: krawędzie stanu s to [off[s], off[s+1]) */
  off: Uint32Array;
  to: Uint32Array;
  dist: Float32Array;
  dur: Float32Array;
  flags: Uint8Array;
  nodeFlags: Uint8Array;
  /** `${city}/${company}` → indeksy węzłów (węzeł wjazdu do firmy) */
  companies: Map<string, number[]>;
  /** geometria krawędzi e (z końcami, środkiem pasa): punkty geom[2·geomOff[e] .. 2·geomOff[e+1]); null = brak (v3) */
  geomOff: Uint32Array | null;
  geom: Float32Array | null;
  grid: SpatialGrid;
}

export interface GraphInput {
  x: ArrayLike<number>;
  z: ArrayLike<number>;
  rot?: ArrayLike<number>;
  nodeFlags?: ArrayLike<number>;
  /** krawędzie: [fromState, toState, dist, dur, flags] */
  edges: readonly (readonly [number, number, number, number, number])[];
  companies?: readonly (readonly [string, string, number])[];
  /** geometria krawędzi (równoległa do `edges`): polilinia [x0, z0, x1, z1, …] w kolejności jazdy, z końcami */
  geometry?: readonly (ArrayLike<number> | null | undefined)[];
}

interface Arrays {
  n: number;
  x: Float32Array;
  z: Float32Array;
  rot: Float32Array;
  off: Uint32Array;
  to: Uint32Array;
  dist: Float32Array;
  dur: Float32Array;
  flags: Uint8Array;
  nodeFlags: Uint8Array;
  geomOff: Uint32Array | null;
  geom: Float32Array | null;
}

const companyKey = (city: string, company: string) => `${city}/${company}`;

/** Buduje graf z list (testy, konwerter). */
export function buildGraph(input: GraphInput): RouteGraph {
  const n = input.x.length;
  const states = 2 * n;
  const off = new Uint32Array(states + 1);
  for (const e of input.edges) off[e[0] + 1]!++;
  for (let s = 0; s < states; s++) off[s + 1]! += off[s]!;
  const m = input.edges.length;
  const to = new Uint32Array(m);
  const dist = new Float32Array(m);
  const dur = new Float32Array(m);
  const flags = new Uint8Array(m);
  const fill = off.slice(0, states);
  const slot = new Uint32Array(m); // indeks krawędzi wejściowej → pozycja w CSR
  input.edges.forEach(([from, t, d, du, f], k) => {
    const i = fill[from]!++;
    slot[k] = i;
    to[i] = t;
    dist[i] = d;
    dur[i] = du;
    flags[i] = f;
  });
  let geomOff: Uint32Array | null = null;
  let geom: Float32Array | null = null;
  if (input.geometry) {
    const count = new Uint32Array(m);
    input.geometry.forEach((pts, k) => {
      if (pts && k < m) count[slot[k]!] = pts.length >> 1;
    });
    geomOff = new Uint32Array(m + 1);
    for (let i = 0; i < m; i++) geomOff[i + 1] = geomOff[i]! + count[i]!;
    geom = new Float32Array(2 * geomOff[m]!);
    input.geometry.forEach((pts, k) => {
      if (!pts || k >= m) return;
      const at = 2 * geomOff![slot[k]!]!;
      for (let j = 0; j < (pts.length & ~1); j++) geom![at + j] = pts[j]!;
    });
  }
  const nodeFlags = input.nodeFlags ? Uint8Array.from(input.nodeFlags) : new Uint8Array(n);
  return finish(
    {
      n,
      x: Float32Array.from(input.x),
      z: Float32Array.from(input.z),
      rot: input.rot ? Float32Array.from(input.rot) : new Float32Array(n).fill(Number.NaN),
      off,
      to,
      dist,
      dur,
      flags,
      nodeFlags,
      geomOff,
      geom,
    },
    input.companies ?? [],
  );
}

/** Polilinia krawędzi e (x, z na przemian, z końcami); pusta tablica = brak danych (cięciwa / krzywa drogi). */
export function edgeGeometry(g: RouteGraph, e: number): Float32Array {
  if (!g.geomOff || !g.geom) return EMPTY;
  return g.geom.subarray(2 * g.geomOff[e]!, 2 * g.geomOff[e + 1]!);
}
const EMPTY = new Float32Array(0);

function finish(a: Arrays, companies: readonly (readonly [string, string, number])[]): RouteGraph {
  const cmap = new Map<string, number[]>();
  for (const [city, company, node] of companies) {
    if (node < 0 || node >= a.n) continue;
    const k = companyKey(city, company);
    const list = cmap.get(k) ?? [];
    if (!list.includes(node)) list.push(node);
    cmap.set(k, list);
  }
  return { ...a, companies: cmap, grid: new SpatialGrid(a.x, a.z) };
}

const pad4 = (len: number) => (4 - (len % 4)) % 4;
const view = (t: ArrayBufferView) => Buffer.from(t.buffer, t.byteOffset, t.byteLength);

/** Serializacja do formatu pliku. */
export function encodeGraph(g: RouteGraph): Buffer {
  const comp: [string, string, number][] = [];
  for (const [k, nodes] of g.companies) {
    const slash = k.indexOf("/");
    for (const node of nodes) comp.push([k.slice(0, slash), k.slice(slash + 1), node]);
  }
  const cjson = Buffer.from(JSON.stringify(comp), "utf8");
  const m = g.to.length;
  const geomOff = g.geomOff ?? new Uint32Array(m + 1);
  const geom = g.geom ?? new Float32Array(0);
  const P = Buffer.alloc(4);
  P.writeUInt32LE(geom.length >> 1, 0);
  const head = Buffer.alloc(20);
  head.write(GRAPH_MAGIC, 0, "ascii");
  head.writeUInt32LE(GRAPH_VERSION, 4);
  head.writeUInt32LE(g.n, 8);
  head.writeUInt32LE(m, 12);
  head.writeUInt32LE(cjson.length, 16);
  return Buffer.concat([
    head,
    view(g.x),
    view(g.z),
    view(g.rot),
    view(g.off),
    view(g.to),
    view(g.dist),
    view(g.dur),
    view(g.flags),
    Buffer.alloc(pad4(m)),
    view(g.nodeFlags),
    Buffer.alloc(pad4(g.n)),
    cjson,
    Buffer.alloc(pad4(cjson.length)),
    P,
    view(geomOff),
    view(geom),
  ]);
}

export function decodeGraph(buf: Buffer): RouteGraph {
  if (buf.length < 20 || buf.toString("ascii", 0, 4) !== GRAPH_MAGIC) throw new Error("route-graph: zły nagłówek");
  const version = buf.readUInt32LE(4);
  if (version !== GRAPH_VERSION && version !== 3)
    throw new Error(`route-graph: wersja ${version}, oczekiwano ${GRAPH_VERSION} (wygeneruj ponownie: npm run map:graph)`);
  const n = buf.readUInt32LE(8);
  const m = buf.readUInt32LE(12);
  const cbytes = buf.readUInt32LE(16);
  let p = 20;
  // kopie (slice): wyrównanie ArrayBuffer nie jest gwarantowane dla Buffer z puli
  const take = (bytes: number): ArrayBuffer => {
    if (p + bytes > buf.length) throw new Error("route-graph: plik ucięty");
    const ab = buf.buffer.slice(buf.byteOffset + p, buf.byteOffset + p + bytes) as ArrayBuffer;
    p += bytes;
    return ab;
  };
  const x = new Float32Array(take(4 * n));
  const z = new Float32Array(take(4 * n));
  const rot = new Float32Array(take(4 * n));
  const off = new Uint32Array(take(4 * (2 * n + 1)));
  const to = new Uint32Array(take(4 * m));
  const dist = new Float32Array(take(4 * m));
  const dur = new Float32Array(take(4 * m));
  const flags = new Uint8Array(take(m));
  p += pad4(m);
  const nodeFlags = new Uint8Array(take(n));
  p += pad4(n);
  if (p + cbytes > buf.length) throw new Error("route-graph: plik ucięty");
  const companies = JSON.parse(buf.toString("utf8", p, p + cbytes)) as [string, string, number][];
  p += cbytes + pad4(cbytes);
  let geomOff: Uint32Array | null = null;
  let geom: Float32Array | null = null;
  if (version >= 4) {
    if (p + 4 > buf.length) throw new Error("route-graph: plik ucięty");
    const P = buf.readUInt32LE(p);
    p += 4;
    geomOff = new Uint32Array(take(4 * (m + 1)));
    geom = new Float32Array(take(8 * P));
  }
  return finish({ n, x, z, rot, off, to, dist, dur, flags, nodeFlags, geomOff, geom }, companies);
}

export const loadGraph = (file: string): RouteGraph => decodeGraph(readFileSync(file));

export const companyNodes = (g: RouteGraph, city: string, company: string): number[] =>
  g.companies.get(companyKey(city, company)) ?? [];

/** Siatka kubełkowa do szukania węzłów w pobliżu punktu. */
export class SpatialGrid {
  static readonly CELL = 250;
  private readonly cells = new Map<number, number[]>();
  private readonly x: Float32Array;
  private readonly z: Float32Array;

  constructor(x: Float32Array, z: Float32Array) {
    this.x = x;
    this.z = z;
    for (let i = 0; i < x.length; i++) {
      const k = SpatialGrid.key(Math.floor(x[i]! / SpatialGrid.CELL), Math.floor(z[i]! / SpatialGrid.CELL));
      const c = this.cells.get(k);
      if (c) c.push(i);
      else this.cells.set(k, [i]);
    }
  }

  private static key(cx: number, cz: number): number {
    // współrzędne gry ETS2 mieszczą się w ±250 km → ±1000 komórek; zapas ×4
    return (cx + 4096) * 8192 + (cz + 4096);
  }

  /** Węzły w promieniu `r` m, posortowane rosnąco po odległości. */
  near(px: number, pz: number, r: number): { node: number; d: number }[] {
    const C = SpatialGrid.CELL;
    const out: { node: number; d: number }[] = [];
    const x0 = Math.floor((px - r) / C);
    const x1 = Math.floor((px + r) / C);
    const z0 = Math.floor((pz - r) / C);
    const z1 = Math.floor((pz + r) / C);
    for (let cx = x0; cx <= x1; cx++)
      for (let cz = z0; cz <= z1; cz++) {
        const c = this.cells.get(SpatialGrid.key(cx, cz));
        if (!c) continue;
        for (const i of c) {
          const d = Math.hypot(this.x[i]! - px, this.z[i]! - pz);
          if (d <= r) out.push({ node: i, d });
        }
      }
    return out.sort((a, b) => a.d - b.d);
  }
}
