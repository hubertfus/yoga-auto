/** Wykrywanie kafli: /tiles/europe.pmtiles (+ opcjonalnie /tiles/projection.json) z tokenem `?k=`. */
import { PMTiles, Protocol } from "pmtiles";
import { getToken } from "../../core/client.ts";
import { parseProjection, type ProjectionConfig } from "./projection.ts";
import type { TileSource } from "./style.ts";

export const TILES_PATH = "/tiles/europe.pmtiles";
export const PROJECTION_PATH = "/tiles/projection.json";

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
    return { tiles: { url, layers }, projection };
  } catch (e) {
    return { tiles: null, projection, reason: e instanceof Error ? e.message : String(e) };
  }
}
