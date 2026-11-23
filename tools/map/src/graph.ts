/**
 * map:graph — konwertuje graf dróg narzędzia truckermudgeon/maps (`generator graph`) + dane parsera
 * do kompaktowego `route-graph.bin`, z którego bridge liczy trasę GPS (bridge/src/route).
 *
 * Wejście (domyślnie tools/map/.cache): parsed/europe-{nodes,roads,companies,cities,prefabs,prefabDescriptions}.json,
 * graph/europe-graph.json. Przejazdy przez prefaby dostają geometrię z krzywych nawigacyjnych gry (prefabPaths.ts).
 * Wyjście (domyślnie tools/map/out): route-graph.bin, route-places.json (wyszukiwarka celu), icons/*.png (ikony POI mapy).
 *
 * Użycie: npm run map:graph -w @yoga-auto/map-tools -- [--cache <dir>] [--out <file>]
 */
import { cpSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EDGE_FERRY, EDGE_ROAD, NODE_CITY, buildGraph, encodeGraph } from "../../../bridge/src/route/graph.ts";
import { fitPrefab, prefabEdgePath, type LocalPath, type PrefabDesc, type PrefabFit } from "./prefabPaths.ts";

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
  token: string;
  name: string;
  countryToken: string;
  x: number;
  y: number;
  areas: { x: number; y: number; width: number; height: number; hidden?: boolean }[];
}
interface PrefabItem {
  uid: string;
  token: string;
  nodeUids: string[];
  originNodeIndex: number;
}
interface CompanyDefJson {
  token: string;
  name: string;
}

/**
 * Lista miejsc do wyszukiwarki celu na tablecie (`route-places.json`, serwowana z katalogu kafli).
 * Krotki zamiast obiektów (mniejszy plik): miasta [nazwa, x, z, kraj, token], firmy [nazwa, miasto, x, z].
 * Token miasta (np. `budapest`) służy do przystanków kursów autobusowych (`bus_job` podaje id miast).
 */
export interface PlacesJson {
  v: 1;
  cities: [string, number, number, string, string][];
  companies: [string, string, number, number][];
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

export function convert(cache: string): { buf: Buffer; places: PlacesJson; stats: Record<string, number> } {
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

  console.log("wczytuję parsed/europe-prefabs.json, prefabDescriptions …");
  const prefabs = read<PrefabItem[]>("parsed/europe-prefabs.json");
  const descs = new Map(read<PrefabDesc[]>("parsed/europe-prefabDescriptions.json").map((d) => [d.token, d]));
  const prefabsOf = new Map<string, number[]>();
  prefabs.forEach((p, i) => {
    for (const u of p.nodeUids) {
      const l = prefabsOf.get(u);
      if (l) l.push(i);
      else prefabsOf.set(u, [i]);
    }
  });
  const prefabPos = new Map<string, { x: number; z: number }>();

  console.log("wczytuję parsed/europe-nodes.json …");
  const index = new Map<string, number>();
  const xs: number[] = [];
  const zs: number[] = [];
  const rots: number[] = [];
  for (const n of read<NodeJson[]>("parsed/europe-nodes.json")) {
    if (prefabsOf.has(n.uid)) prefabPos.set(n.uid, { x: n.x, z: n.y });
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

  // dopasowanie prefabów do świata (leniwie, raz na prefab) i ścieżki przejazdu
  const fits = new Map<number, PrefabFit | null>();
  const fitOf = (pi: number): PrefabFit | null => {
    let f = fits.get(pi);
    if (f !== undefined) return f;
    const p = prefabs[pi]!;
    const d = descs.get(p.token);
    const w = p.nodeUids.map((u) => prefabPos.get(u));
    f = d && w.every(Boolean) ? fitPrefab(d, w as { x: number; z: number }[], p.originNodeIndex) : null;
    fits.set(pi, f);
    return f;
  };
  const pathCache = new Map<string, LocalPath | null>();
  let prefabPaths = 0;
  const pathThrough = (a: string, b: string): number[] | null => {
    const pb = prefabsOf.get(b);
    const pi = pb && prefabsOf.get(a)?.find((x) => pb.includes(x));
    if (pi === undefined || pi === null) return null;
    const f = fitOf(pi);
    const p = prefabs[pi]!;
    const A = prefabPos.get(a);
    const B = prefabPos.get(b);
    if (!f || !A || !B) return null;
    const path = prefabEdgePath(descs.get(p.token)!, f, p.nodeUids.indexOf(a), p.nodeUids.indexOf(b), A, B, pathCache);
    if (path) prefabPaths++;
    return path;
  };

  const edges: [number, number, number, number, number][] = [];
  const geometry: (number[] | null)[] = [];
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
        geometry.push(flags ? null : pathThrough(uid, n.nodeUid));
      }
    }
  }

  console.log("wczytuję parsed/europe-cities.json …");
  // obszar miasta: prostokąt od rogu (x, y) o wymiarach width × height (zweryfikowane na pozycjach firm)
  const cities = read<CityJson[]>("parsed/europe-cities.json");
  const areas = cities.flatMap((c) => c.areas);
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
  const companyList = read<CompanyJson[]>("parsed/europe-companies.json");
  for (const c of companyList) {
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
  const g = buildGraph({ x: xs, z: zs, rot: rots, nodeFlags, edges, companies, geometry });

  const places = buildPlaces(cities, companyList, read<CompanyDefJson[]>("parsed/europe-companyDefs.json"));

  return {
    buf: encodeGraph(g),
    places,
    stats: {
      nodes: g.n,
      nodesInCity: inCity,
      edges: edges.length,
      ferries,
      missingNodes: missing,
      companies: g.companies.size,
      companiesNear: viaNear,
      companiesUnmatched: unmatched,
      prefabPaths,
      geometryPoints: (g.geom?.length ?? 0) / 2,
    },
  };
}

/** Miejsca do wyszukiwarki i przystanków: środek widocznego obszaru miasta, firmy z nazwami z companyDefs. */
export function buildPlaces(cities: CityJson[], companyList: CompanyJson[], defList: CompanyDefJson[]): PlacesJson {
  const defs = new Map(defList.map((d) => [d.token, d.name]));
  const cityName = new Map(cities.map((c) => [c.token, c.name]));
  return {
    v: 1,
    cities: cities.map((c) => {
      const a = c.areas.find((x) => !x.hidden) ?? c.areas[0];
      const cx = a ? a.x + a.width / 2 : c.x;
      const cz = a ? a.y + a.height / 2 : c.y;
      return [c.name, Math.round(cx), Math.round(cz), c.countryToken, c.token];
    }),
    companies: companyList
      .filter((c) => cityName.has(c.cityToken))
      .map((c) => [defs.get(c.token) ?? c.token, cityName.get(c.cityToken)!, Math.round(c.x), Math.round(c.y)]),
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
  if (argv.includes("--places-only")) {
    // szybko: tylko route-places.json (bez przeliczania grafu)
    const read = <T>(p: string): T => JSON.parse(readFileSync(join(cache, p), "utf8")) as T;
    const places = buildPlaces(
      read<CityJson[]>("parsed/europe-cities.json"),
      read<CompanyJson[]>("parsed/europe-companies.json"),
      read<CompanyDefJson[]>("parsed/europe-companyDefs.json"),
    );
    writeFileSync(join(dirname(out), "route-places.json"), JSON.stringify(places));
    console.log(`zapisano route-places.json (${places.cities.length} miast, ${places.companies.length} firm)`);
    return;
  }
  const { buf, places, stats } = convert(cache);
  writeFileSync(out, buf);
  console.log(`zapisano ${out} (${(buf.length / 1e6).toFixed(1)} MB)`, stats);
  const outDir = dirname(out);
  writeFileSync(join(outDir, "route-places.json"), JSON.stringify(places));
  console.log(`zapisano route-places.json (${places.cities.length} miast, ${places.companies.length} firm)`);
  // ikony POI (stacje, parkingi, logo firm, numery dróg) dla mapy: /tiles/icons/<sprite>.png
  const icons = join(cache, "parsed", "icons");
  if (existsSync(icons)) {
    cpSync(icons, join(outDir, "icons"), { recursive: true });
    console.log(`skopiowano ikony → ${join(outDir, "icons")}`);
  } else console.warn(`brak ${icons} (parser bez ikon?) — mapa bez ikon POI`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
