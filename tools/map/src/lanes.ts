/**
 * map:lanes — drogi z pasami ruchu dla mapy na tablecie (`roads.pmtiles`, warstwa `lanes`).
 *
 * Kafle truckermudgeon mają tylko linię środka drogi, więc na zbliżeniu drogi są cienkie i nie widać,
 * po której stronie jedzie ciężarówka. Tu z danych parsera (drogi + węzły + `roadLooks`) budujemy linie
 * środka każdego odcinka (krzywe Hermite'a jak w grze) z liczbą pasów w każdą stronę i szerokością pasa
 * rozdzielającego; styl rysuje z nich jezdnie w prawdziwej skali i linie pasów (`line-offset`).
 *
 * Właściwości obiektu (krótkie nazwy — mniejsze kafle):
 *   l, r  — pasy po lewej / prawej względem kierunku start → koniec odcinka (r = jazda „do przodu”)
 *   w     — szerokość pasa (m świata gry)
 *   o     — odstęp między jezdniami (pas rozdzielający, m)
 *   k     — px na 1 m świata gry przy zoomie 10 (zależy od szerokości geograficznej i skali mapy)
 *   c     — klasa: 2 autostrada, 1 ekspresowa, 0 lokalna
 *
 * Wejście: tools/map/.cache/parsed/europe-{nodes,roads,roadLooks}.json + tools/map/out/projection.json
 * Wyjście: tools/map/.cache/lanes.geojsonl (GeoJSON, obiekt na linię) → tippecanoe → tools/map/out/roads.pmtiles
 *
 * Użycie: npm run map:lanes -w @yoga-auto/map-tools   (tippecanoe w PATH albo --docker <obraz z tippecanoe>)
 */
import { spawnSync } from "node:child_process";
import { createWriteStream, existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gameToLonLat, parseProjection, type ProjectionConfig } from "../../../apps/yoga/src/features/map/projection.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

interface NodeJson {
  uid: string;
  x: number;
  y: number;
  rotation: number;
}
interface RoadJson {
  hidden?: boolean;
  roadLookToken: string;
  startNodeUid: string;
  endNodeUid: string;
  length: number;
}
interface RoadLookJson {
  token: string;
  lanesLeft: string[];
  lanesRight: string[];
  offset?: number;
}

/** Szerokość pasa w ETS2 (m świata gry); wąskie drogi lokalne — mniej. */
export const LANE_W = 4.5;
const NARROW_W = 3.25;

/** Pasy rysowane na mapie: wszystko poza torami (także `slow_road` na mostach/„niewidzialnych” drogach i `no_vehicles` — wjazdy, drogi gruntowe). */
const isDrivable = (lane: string) => lane.startsWith("traffic_lane.") && !lane.startsWith("traffic_lane.rail");

export interface LaneLook {
  l: number;
  r: number;
  w: number;
  o: number;
  c: 0 | 1 | 2;
}

export function laneLook(look: RoadLookJson): LaneLook | null {
  const l = look.lanesLeft.filter(isDrivable);
  const r = look.lanesRight.filter(isDrivable);
  if (!l.length && !r.length) return null;
  const all = [...l, ...r];
  const narrow = all.every((x) => /narrow|single_track|dust/.test(x));
  const c = all.some((x) => x.includes("motorway")) ? 2 : all.some((x) => x.includes("expressway")) ? 1 : 0;
  return { l: l.length, r: r.length, w: narrow ? NARROW_W : LANE_W, o: Math.max(0, look.offset ?? 0), c };
}

/** Punkty krzywej odcinka a → b (łącznie z końcami), styczne z obrotów węzłów (±(cos, sin)). */
export function curve(a: NodeJson, b: NodeJson): [number, number][] {
  const dx = b.x - a.x;
  const dz = b.y - a.y;
  const L = Math.hypot(dx, dz);
  const pts: [number, number][] = [[a.x, a.y]];
  if (L >= 8) {
    let t0x = Math.cos(a.rotation);
    let t0z = Math.sin(a.rotation);
    if (t0x * dx + t0z * dz < 0) [t0x, t0z] = [-t0x, -t0z];
    let t1x = Math.cos(b.rotation);
    let t1z = Math.sin(b.rotation);
    if (t1x * dx + t1z * dz < 0) [t1x, t1z] = [-t1x, -t1z];
    const straight = (t0x * dx + t0z * dz) / L > 0.9995 && (t1x * dx + t1z * dz) / L > 0.9995;
    if (!straight) {
      const k = Math.max(2, Math.min(32, Math.ceil(L / 10)));
      for (let j = 1; j < k; j++) {
        const t = j / k;
        const t2 = t * t;
        const t3 = t2 * t;
        const h00 = 2 * t3 - 3 * t2 + 1;
        const h10 = t3 - 2 * t2 + t;
        const h01 = -2 * t3 + 3 * t2;
        const h11 = t3 - t2;
        pts.push([h00 * a.x + h10 * L * t0x + h01 * b.x + h11 * L * t1x, h00 * a.y + h10 * L * t0z + h01 * b.y + h11 * L * t1z]);
      }
    }
  }
  pts.push([b.x, b.y]);
  return pts;
}

const WORLD_PX_Z10 = 512 * 1024;
function mercPx(lon: number, lat: number): [number, number] {
  const s = Math.sin((lat * Math.PI) / 180);
  return [((lon + 180) / 360) * WORLD_PX_Z10, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * WORLD_PX_Z10];
}

/** px (Web Mercator, zoom 10) na 1 m świata gry w okolicy punktu — mierzone na projekcji mapy. */
export function pxPerGameMeter(x: number, z: number, cfg: ProjectionConfig): number {
  const a = gameToLonLat(x, z, cfg);
  const b = gameToLonLat(x + 50, z, cfg);
  const c = gameToLonLat(x, z + 50, cfg);
  const [ax, ay] = mercPx(a.lon, a.lat);
  const [bx, by] = mercPx(b.lon, b.lat);
  const [cx, cy] = mercPx(c.lon, c.lat);
  return (Math.hypot(bx - ax, by - ay) + Math.hypot(cx - ax, cy - ay)) / 100;
}

function main(): void {
  const argv = process.argv.slice(2);
  const arg = (k: string, d: string | null) => {
    const i = argv.indexOf(k);
    return i >= 0 && argv[i + 1] ? argv[i + 1]! : d;
  };
  const cache = resolve(arg("--cache", join(root, ".cache"))!);
  const outDir = resolve(arg("--out", join(root, "out"))!);
  const docker = arg("--docker", null);
  const projFile = join(outDir, "projection.json");
  if (!existsSync(projFile)) throw new Error(`brak ${projFile} (npm run map:calibrate)`);
  const cfg = parseProjection(JSON.parse(readFileSync(projFile, "utf8")));
  if (!cfg) throw new Error("projection.json: zły format");
  const read = <T>(p: string): T => JSON.parse(readFileSync(join(cache, "parsed", p), "utf8")) as T;

  console.log("wczytuję roadLooks, roads …");
  const looks = new Map<string, LaneLook | null>(read<RoadLookJson[]>("europe-roadLooks.json").map((l) => [l.token, laneLook(l)]));
  const roads = read<RoadJson[]>("europe-roads.json").filter((r) => !r.hidden);
  const need = new Set<string>();
  for (const r of roads) {
    need.add(r.startNodeUid);
    need.add(r.endNodeUid);
  }
  console.log("wczytuję nodes …");
  const nodes = new Map<string, NodeJson>();
  for (const n of read<NodeJson[]>("europe-nodes.json")) if (need.has(n.uid)) nodes.set(n.uid, n);

  const file = join(cache, "lanes.geojsonl");
  const out = createWriteStream(file);
  let n = 0;
  let skipped = 0;
  for (const r of roads) {
    const look = looks.get(r.roadLookToken);
    const a = nodes.get(r.startNodeUid);
    const b = nodes.get(r.endNodeUid);
    if (!look || !a || !b) {
      skipped++;
      continue;
    }
    const coords = curve(a, b).map(([x, z]) => {
      const p = gameToLonLat(x, z, cfg);
      return [Math.round(p.lon * 1e7) / 1e7, Math.round(p.lat * 1e7) / 1e7];
    });
    const k = Math.round(pxPerGameMeter((a.x + b.x) / 2, (a.y + b.y) / 2, cfg) * 1e4) / 1e4;
    const f = { type: "Feature", properties: { ...look, k }, geometry: { type: "LineString", coordinates: coords } };
    out.write(JSON.stringify(f) + "\n");
    n++;
  }
  out.end();
  out.on("finish", () => {
    console.log(`zapisano ${file}: ${n} odcinków (pominięto ${skipped}: bez pasów jezdnych / brak węzłów)`);
    const target = join(outDir, "roads.pmtiles");
    // pasy pokazujemy od zoomu ~11,5; maks. 14 (wyżej MapLibre powiększa), bez gubienia odcinków
    const tip = ["-o", "OUT", "-l", "lanes", "-Z", "11", "-z", "14", "--force", "--no-feature-limit", "--no-tile-size-limit", "--simplification=2", "IN"];
    let res;
    if (docker) {
      // wynik najpierw w /tmp kontenera: zapis bazy tippecanoe przez zamontowany katalog Windows jest kilkukrotnie wolniejszy
      const args = tip.map((x) => (x === "OUT" ? "/tmp/roads.pmtiles" : x === "IN" ? "/work/lanes.geojsonl" : x));
      const script = `tippecanoe ${args.join(" ")} && cp /tmp/roads.pmtiles /out/roads.pmtiles`;
      res = spawnSync("docker", ["run", "--rm", "-v", `${cache}:/work`, "-v", `${outDir}:/out`, "--entrypoint", "sh", docker, "-c", script], {
        stdio: "inherit",
      });
    } else {
      res = spawnSync("tippecanoe", tip.map((x) => (x === "OUT" ? target : x === "IN" ? file : x)), { stdio: "inherit" });
    }
    if (res.status !== 0) throw new Error(`tippecanoe zakończone kodem ${res.status} (zainstaluj tippecanoe albo użyj --docker <obraz>)`);
    console.log(`gotowe: ${target}`);
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
