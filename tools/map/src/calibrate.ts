/**
 * map:calibrate — dopasowuje projekcję gry do kafli z kotwic.
 * Wejście: JSON `[{ "x": <gra x>, "z": <gra z>, "lon": .., "lat": .. }, ...]` (≥ 2, najlepiej 5–10 miast rozrzuconych po mapie;
 * współrzędne gry i lon/lat tych samych miast bierzesz z danych wygenerowanych przez narzędzie).
 * Użycie: npm run map:calibrate -w @yoga-auto/map-tools -- anchors.json [projection.json]
 * Wyjście: projection.json (kalibracja + RMS w metrach gry); serwowany jako /tiles/projection.json.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_LCC, fitCalibration, type Anchor } from "../../../apps/yoga/src/features/map/projection.ts";

export function calibrate(anchors: Anchor[]) {
  const fit = fitCalibration(anchors, DEFAULT_LCC);
  return { lcc: DEFAULT_LCC, calibration: fit.calibration, rmsGameM: fit.rmsGameM, rmsRealM: fit.rmsRealM, anchors: anchors.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [inFile, outFile = "projection.json"] = process.argv.slice(2);
  if (!inFile) {
    console.error("Użycie: map:calibrate -- anchors.json [projection.json]");
    process.exit(1);
  }
  const result = calibrate(JSON.parse(readFileSync(inFile, "utf8")) as Anchor[]);
  writeFileSync(outFile, JSON.stringify(result, null, 2));
  console.log(`Zapisano ${outFile}: ${result.anchors} kotwic, RMS ${result.rmsGameM.toFixed(1)} m gry (${result.rmsRealM.toFixed(0)} m rzecz.)`);
}
