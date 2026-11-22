/**
 * map:build — generuje europe.pmtiles z plików gry użytkownika, używając truckermudgeon/maps (GPL-3.0)
 * jako ZEWNĘTRZNEGO narzędzia sklonowanego do tools/map/.cache/. Nie vendorujemy jego kodu.
 *
 * Użycie:  npm run map:build -w @yoga-auto/map-tools -- --game "C:\...\Euro Truck Simulator 2"
 * Opcje:   --out <dir>        katalog wyjściowy (domyślnie tools/map/out)
 *          --dry-run          tylko wypisz plan i sprawdź wymagania; nic nie pobiera ani nie uruchamia
 *          --yes              nie pytaj o zgodę na pobranie (klon + npm install, kilkaset MB)
 *          --generator-args   dodatkowe argumenty dla `generator map` (patrz README repo narzędzia)
 * Wynik:   <out>/meta.json (wersja gry, DLC, commit narzędzia, data) + europe.pmtiles (skopiowany ręcznie, patrz README)
 *          + <out>/route-graph.bin (graf dróg do trasy GPS, `map:graph`).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";

const REPO = "https://github.com/truckermudgeon/maps";
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const cache = join(root, ".cache");
const repoDir = join(cache, "maps");

export interface Args {
  game: string | null;
  out: string;
  dryRun: boolean;
  yes: boolean;
  generatorArgs: string[];
}

export function parseArgs(argv: string[]): Args {
  const a: Args = { game: null, out: join(root, "out"), dryRun: false, yes: false, generatorArgs: [] };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--game") a.game = argv[++i] ?? null;
    else if (k === "--out") a.out = resolve(argv[++i] ?? a.out);
    else if (k === "--dry-run") a.dryRun = true;
    else if (k === "--yes") a.yes = true;
    else if (k === "--generator-args") a.generatorArgs = (argv[++i] ?? "").split(" ").filter(Boolean);
  }
  return a;
}

/** Wersja gry (version.txt w katalogu głównym, jeśli jest) i lista DLC (pliki dlc_*.scs). */
export function readGameInfo(game: string): { version: string | null; dlc: string[] } {
  const vf = join(game, "version.txt");
  const version = existsSync(vf) ? (readFileSync(vf, "utf8").trim().split(/\r?\n/)[0] ?? null) : null;
  const dlc = existsSync(game)
    ? readdirSync(game)
        .filter((f) => /^dlc_.*\.scs$/i.test(f))
        .map((f) => f.replace(/\.scs$/i, ""))
        .sort()
    : [];
  return { version, dlc };
}

function run(cmd: string, args: string[], cwd: string, dry: boolean): void {
  console.log(`> (${cwd}) ${cmd} ${args.join(" ")}`);
  if (dry) return;
  const win = process.platform === "win32";
  // shell:true na Windows skleja argumenty bez cudzysłowów — ścieżki ze spacjami trzeba ująć samemu
  const safe = win ? args.map((a) => (/\s/.test(a) ? `"${a}"` : a)) : args;
  const r = spawnSync(cmd, safe, { cwd, stdio: "inherit", shell: win });
  if (r.status !== 0) throw new Error(`${cmd} zakończyło się kodem ${r.status}`);
}

function has(cmd: string): boolean {
  const r = spawnSync(cmd, ["--version"], { stdio: "ignore", shell: process.platform === "win32" });
  return r.status === 0;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.game) throw new Error('Podaj katalog gry: --game "C:\\...\\Euro Truck Simulator 2"');
  const info = readGameInfo(args.game);
  console.log(
    `Gra: ${args.game}\n  wersja: ${info.version ?? "(brak version.txt)"}\n  DLC: ${info.dlc.join(", ") || "(brak dlc_*.scs)"}`,
  );
  if (!existsSync(args.game) && !args.dryRun) throw new Error("Katalog gry nie istnieje");

  const missing = ["git", "npm"].filter((c) => !has(c));
  if (!has("tippecanoe")) missing.push("tippecanoe (WSL: sudo apt install tippecanoe, albo prebuilt; musi być w PATH)");
  if (missing.length) {
    console.warn(`Brakuje: ${missing.join(", ")}`);
    if (!args.dryRun) throw new Error("Zainstaluj brakujące narzędzia (patrz tools/map/README.md)");
  }

  console.log(
    `\nPlan: klon ${REPO} -> ${repoDir} (jeśli brak), npm install + build parsera, parser -> generator map -m europe -> ${args.out}`,
  );
  if (!args.dryRun && !existsSync(repoDir) && !args.yes) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const ans = await rl.question("Pobrać repo narzędzia (GPL-3.0) i zależności npm (kilkaset MB)? [t/N] ");
    rl.close();
    if (!/^(t|y)/i.test(ans.trim())) throw new Error("Przerwano przez użytkownika");
  }

  if (!args.dryRun) {
    mkdirSync(cache, { recursive: true });
    mkdirSync(args.out, { recursive: true });
  }
  if (!existsSync(repoDir)) {
    run("git", ["clone", "--depth", "1", "--recurse-submodules", REPO, repoDir], cache, args.dryRun);
  }
  run("npm", ["install"], repoDir, args.dryRun);
  run("npm", ["run", "build", "-w", "packages/clis/parser"], repoDir, args.dryRun);
  const parsed = join(cache, "parsed");
  run("npx", ["parser", "-i", args.game, "-o", parsed], repoDir, args.dryRun);
  run("npx", ["generator", "map", "-m", "europe", ...args.generatorArgs], repoDir, args.dryRun);
  // graf dróg do trasy GPS (bridge): generator graph → tools/map/.cache/graph, potem konwersja do route-graph.bin
  run("npx", ["generator", "graph", "-m", "europe", "-i", parsed, "-o", join(cache, "graph")], repoDir, args.dryRun);
  run("node", ["--max-old-space-size=8192", join(here, "graph.ts"), "--cache", cache, "--out", join(args.out, "route-graph.bin")], root, args.dryRun);
  // jezdnie z pasami (roads.pmtiles) — wymaga projection.json (map:calibrate); bez niego krok pomijamy
  if (existsSync(join(args.out, "projection.json")))
    run("node", ["--max-old-space-size=8192", join(here, "lanes.ts"), "--cache", cache, "--out", args.out], root, args.dryRun);
  else console.log("(pomijam map:lanes: brak projection.json — uruchom po map:calibrate)");

  if (args.dryRun) {
    console.log("\n(dry-run: nic nie pobrano ani nie uruchomiono)");
    return;
  }
  const commit = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repoDir, encoding: "utf8" }).stdout.trim();
  const meta = {
    generatedAt: new Date().toISOString(),
    game: { version: info.version, dlc: info.dlc },
    tool: { repo: REPO, commit },
    note: "Skopiuj europe.pmtiles do katalogu kafli bridge'a (/tiles/europe.pmtiles); projection.json: npm run map:calibrate.",
  };
  writeFileSync(join(args.out, "meta.json"), JSON.stringify(meta, null, 2));
  console.log(`\nGotowe: meta.json w ${args.out}. Znajdź europe.pmtiles wg README narzędzia i skopiuj do ${args.out}.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e: unknown) => {
    console.error(String(e instanceof Error ? e.message : e));
    process.exit(1);
  });
}
