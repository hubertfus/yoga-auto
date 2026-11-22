/** Wykrywanie kafli: /tiles/europe.pmtiles (+ opcjonalnie /tiles/projection.json) z tokenem `?k=`. */
import { PMTiles, Protocol } from "pmtiles";
import { getToken } from "../../core/client.ts";
import { parseProjection, type ProjectionConfig } from "./projection.ts";
import type { TileSource } from "./style.ts";

export const TILES_PATH = "/tiles/europe.pmtiles";
export const PROJECTION_PATH = "/tiles/projection.json";
/** jezdnie z pasami (opcjonalne, `map:lanes`) */
export const LANES_PATH = "/tiles/roads.pmtiles";

export interface TileProbe {
  tiles: TileSource | null;
  projection: ProjectionConfig | null;
  /** powód braku kafli (do komunikatu diagnostycznego) */
  reason?: string;
}

export const withToken = (path: string, token: string | null): string =>
  token ? `${path}${path.includes("?") ? "&" : "?"}k=${encodeURIComponent(token)}` : path;

/** Absolutny URL (pmtiles:// wymaga pełnego adresu) względem origin aplikacji (Vite proxy / bridge). */
const absolute = (path: string): string => (typeof location === "undefined" ? path : new URL(path, location.href).href);

export async function fetchProjection(
  fetchFn: typeof fetch = fetch,
  token: string | null = getToken(),
): Promise<ProjectionConfig | null> {
  try {
    const res = await fetchFn(withToken(PROJECTION_PATH, token));
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) return null;
    return parseProjection(await res.json());
  } catch {
    return null;
  }
}

let protocol: Protocol | null = null;

/** Rejestruje protokół pmtiles w MapLibre (raz) i zwraca instancję `Protocol` do `add()`. */
export function pmtilesProtocol(): Protocol {
  protocol ??= new Protocol();
  return protocol;
}

export async function probeTiles(): Promise<TileProbe> {
  const token = getToken();
  const url = absolute(withToken(TILES_PATH, token));
  const projection = await fetchProjection(fetch, token);
  try {
    const p = new PMTiles(url);
    pmtilesProtocol().add(p);
    const meta = (await p.getMetadata()) as { vector_layers?: { id: string }[] } | undefined;
    const layers = meta?.vector_layers?.map((l) => l.id) ?? [];
    if (!layers.length) return { tiles: null, projection, reason: "kafle bez warstw wektorowych" };
    const lanes = await probeLanes(token);
    return { tiles: lanes ? { url, layers, lanes } : { url, layers }, projection };
  } catch (e) {
    return { tiles: null, projection, reason: e instanceof Error ? e.message : String(e) };
  }
}

/** Czy są kafle jezdni z pasami (`roads.pmtiles`); zwraca ich adres albo null (stara instalacja bez map:lanes). */
async function probeLanes(token: string | null): Promise<string | null> {
  const url = absolute(withToken(LANES_PATH, token));
  try {
    const p = new PMTiles(url);
    const meta = (await p.getMetadata()) as { vector_layers?: { id: string }[] } | undefined;
    if (!meta?.vector_layers?.some((l) => l.id === "lanes")) return null;
    pmtilesProtocol().add(p);
    return url;
  } catch {
    return null;
  }
}
