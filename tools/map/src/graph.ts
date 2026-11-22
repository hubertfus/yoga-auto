/**
 * map:graph — konwertuje graf dróg narzędzia truckermudgeon/maps (`generator graph`) + dane parsera
 * do kompaktowego `route-graph.bin`, z którego bridge liczy trasę GPS (bridge/src/route).
 *
 * Wejście (domyślnie tools/map/.cache): parsed/europe-{nodes,roads,companies,cities}.json, graph/europe-graph.json.
 * Wyjście (domyślnie tools/map/out/route-graph.bin).
 *
 * Użycie: npm run map:graph -w @yoga-auto/map-tools -- [--cache <dir>] [--out <file>]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EDGE_FERRY, EDGE_ROAD, NODE_CITY, buildGraph, encodeGraph } from "../../../bridge/src/route/graph.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

interface Neighbor {
  nodeUid: string;
  distance: number;
  duration: number;
  direction: "forward" | "backward";
  isFerry?: boolean;
}
interface GraphJson {
  graph: [string, { forward: Neighbor[]; backward: Neighbor[] }][];
}
interface NodeJson {
  uid: string;
  x: number;
  y: number;
  rotation: number;
}
interface RoadJson {
  startNodeUid: string;
  endNodeUid: string;
}
interface CityJson {
  areas: { x: number; y: number; width: number; height: number }[];
}
interface CompanyJson {
  token: string;
  cityToken: string;
  x: number;
  y: number;
  nodeUid: string;
}

/** promień dopasowania firmy do węzłów grafu, gdy jej węzeł nie jest w grafie */
const COMPANY_RADIUS = 120;

export function convert(cache: string): { buf: Buffer; stats: Record<string, number> } {
  const read = <T>(p: string): T => JSON.parse(readFileSync(join(cache, p), "utf8")) as T;
  console.log("wczytuję graph/europe-graph.json …");
  const gj = read<GraphJson>("graph/europe-graph.json");
  const uids = new Set<string>();
  for (const [uid, nb] of gj.graph) {
    uids.add(uid);
    for (const n of nb.forward) uids.add(n.nodeUid);
    for (const n of nb.backward) uids.add(n.nodeUid);
  }
  console.log(`  ${gj.graph.length} węzłów z sąsiadami, ${uids.size} łącznie`);

  console.log("wczytuję parsed/europe-nodes.json …");
  const index = new Map<string, number>();
  const xs: number[] = [];
  const zs: number[] = [];
  const rots: number[] = [];
  for (const n of read<NodeJson[]>("parsed/europe-nodes.json")) {
    if (!uids.has(n.uid) || index.has(n.uid)) continue;
    index.set(n.uid, xs.length);
    xs.push(n.x);
    zs.push(n.y); // parser: y = oś z gry (płaszczyzna mapy)
    rots.push(n.rotation); // styczna drogi = ±(cos, sin) — sprawdzone na cięciwach odcinków (mediana |cos| 0,997)
  }
  const missing = uids.size - index.size;

  console.log("wczytuję parsed/europe-roads.json …");
  const roads = new Set<string>();
  for (const r of read<RoadJson[]>("parsed/europe-roads.json")) {
    roads.add(`${r.startNodeUid}|${r.endNodeUid}`);
    roads.add(`${r.endNodeUid}|${r.startNodeUid}`);
  }

  const edges: [number, number, number, number, number][] = [];
  let ferries = 0;
  for (const [uid, nb] of gj.graph) {
    const a = index.get(uid);
    if (a === undefined) continue;
    for (const [dir, list] of [
      [0, nb.forward],
      [1, nb.backward],
    ] as const) {
      for (const n of list) {
        const b = index.get(n.nodeUid);
        if (b === undefined) continue;
        let flags = 0;
        if (n.isFerry) {
          flags |= EDGE_FERRY;
          ferries++;
        }
        if (roads.has(`${uid}|${n.nodeUid}`)) flags |= EDGE_ROAD;
        edges.push([a * 2 + dir, b * 2 + (n.direction === "forward" ? 0 : 1), n.distance, n.duration, flags]);
      }
    }
  }

  console.log("wczytuję parsed/europe-cities.json …");
  // obszar miasta: prostokąt od rogu (x, y) o wymiarach width × height (zweryfikowane na pozycjach firm)
  const areas = read<CityJson[]>("parsed/europe-cities.json").flatMap((c) => c.areas);
  const nodeFlags = new Uint8Array(xs.length);
  let inCity = 0;
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i]!;
    const z = zs[i]!;
    if (areas.some((a) => x >= a.x && x <= a.x + a.width && z >= a.y && z <= a.y + a.height)) {
      nodeFlags[i] = NODE_CITY;
      inCity++;
    }
  }

  console.log("wczytuję parsed/europe-companies.json …");
  const g0 = buildGraph({ x: xs, z: zs, edges });
  const companies: [string, string, number][] = [];
  let viaNear = 0;
  let unmatched = 0;
  for (const c of read<CompanyJson[]>("parsed/europe-companies.json")) {
    const direct = index.get(c.nodeUid);
    if (direct !== undefined) {
      companies.push([c.cityToken, c.token, direct]);
      continue;
    }
    const near = g0.grid.near(c.x, c.y, COMPANY_RADIUS).filter(({ node }) => g0.off[node * 2] !== g0.off[node * 2 + 2]);
    if (!near.length) {
      unmatched++;
      continue;
    }
    viaNear++;
    for (const { node } of near.slice(0, 3)) companies.push([c.cityToken, c.token, node]);
  }
  const g = buildGraph({ x: xs, z: zs, rot: rots, nodeFlags, edges, companies });
  return {
    buf: encodeGraph(g),
    stats: { nodes: g.n, nodesInCity: inCity, edges: edges.length, ferries, missingNodes: missing, companies: g.companies.size, companiesNear: viaNear, companiesUnmatched: unmatched },
  };
}

function main(): void {
  const argv = process.argv.slice(2);
  const arg = (k: string, d: string) => {
    const i = argv.indexOf(k);
    return i >= 0 && argv[i + 1] ? resolve(argv[i + 1]!) : d;
  };
  const cache = arg("--cache", join(root, ".cache"));
  const out = arg("--out", join(root, "out", "route-graph.bin"));
  const { buf, stats } = convert(cache);
  writeFileSync(out, buf);
  console.log(`zapisano ${out} (${(buf.length / 1e6).toFixed(1)} MB)`, stats);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
