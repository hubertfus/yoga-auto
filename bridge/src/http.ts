/**
 * Warstwa HTTP bridge'a (PROTOCOL.md §6):
 *  - filtr adresu źródłowego, kontrola `Host` (DNS rebinding) i `Origin` (CSRF z innych stron) + CORS;
 *  - `/api/info`, `/api/pair/start`, `/api/pair/confirm`;
 *  - zasoby modułów (`/media/art/…`) i kafle (`/tiles/*.pmtiles`) za tokenem (`?k=` albo `Authorization: Bearer`);
 *  - PWA ze statycznego katalogu: ETag, cache (`/assets/*` immutable), `Range`, fallback SPA.
 */
import { createReadStream, existsSync, statSync, type Stats } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import {
  PROTOCOL_MINOR,
  PROTOCOL_VERSION,
  type InfoRes,
  type PairConfirmReq,
  type PairStartRes,
} from "@yoga-auto/protocol";
import { hostAllowed, isPrivateAddress, originAllowed, type OriginPolicy } from "./access.ts";
import type { DeviceRecord, DeviceStore } from "./devices.ts";
import type { StaticHandler } from "./modules/types.ts";
import type { PairingManager } from "./pairing.ts";

export const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
  ".map": "application/json",
  ".pmtiles": "application/octet-stream",
};

export interface HttpDeps {
  auth: boolean;
  devices: DeviceStore | null;
  pairing: PairingManager | null;
  statics: ReadonlyMap<string, StaticHandler>;
  staticDir: string | null;
  /** katalog z `*.pmtiles` (M4), serwowany pod `/tiles/` za tokenem */
  tilesDir?: string | null;
  version: string;
  /** historia zleceń dla `GET /api/jobs` (M4); brak = 404 */
  jobs?: ((limit: number) => unknown) | undefined;
  policy: OriginPolicy;
  log: (level: "debug" | "info" | "warn" | "error", msg: string) => void;
}

/** Token z nagłówka `Authorization: Bearer` albo parametru `k`. */
export function tokenFromRequest(req: IncomingMessage, url: URL): string | undefined {
  const h = req.headers.authorization;
  if (h?.toLowerCase().startsWith("bearer ")) return h.slice(7).trim();
  return url.searchParams.get("k") ?? undefined;
}

export function authorize(deps: HttpDeps, token: string | undefined, ip: string | undefined): DeviceRecord | "open" | null {
  if (!deps.auth) return "open";
  return deps.devices?.verify(token, ip) ?? null;
}

const json = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void => {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", ...headers });
  res.end(JSON.stringify(body));
};

function readJson(req: IncomingMessage, limit = 4096): Promise<unknown | null> {
  return new Promise((resolveBody) => {
    const type = String(req.headers["content-type"] ?? "");
    if (!type.toLowerCase().startsWith("application/json")) return resolveBody(null);
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        resolveBody(null);
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolveBody(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        resolveBody(null);
      }
    });
    req.on("error", () => resolveBody(null));
  });
}

export function createHttpHandler(deps: HttpDeps) {
  const staticRoot = deps.staticDir ? resolve(deps.staticDir) : null;
  const tilesRoot = deps.tilesDir ? resolve(deps.tilesDir) : null;

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const ip = req.socket.remoteAddress;
    if (!isPrivateAddress(ip)) {
      res.writeHead(403).end();
      return;
    }
    if (!hostAllowed(req.headers.host, deps.policy)) {
      res.writeHead(421).end(); // Misdirected Request
      return;
    }
    const url = new URL(req.url ?? "/", "http://x");
    const path = url.pathname;
    const origin = req.headers.origin;
    const originOk = originAllowed(origin, req.headers.host, deps.policy);
    const cors: Record<string, string> =
      origin && originOk
        ? {
            "access-control-allow-origin": origin,
            vary: "Origin",
            "access-control-allow-methods": "GET, POST, OPTIONS",
            "access-control-allow-headers": "content-type, authorization",
            "access-control-max-age": "600",
          }
        : {};

    if (path.startsWith("/api/")) {
      if (!originOk) return json(res, 403, { error: "forbidden_origin" });
      if (req.method === "OPTIONS") {
        res.writeHead(204, cors).end();
        return;
      }
      return api(req, res, url, cors, ip);
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { allow: "GET, HEAD" }).end();
      return;
    }

    // zasoby za tokenem
    for (const [prefix, handler] of deps.statics) {
      if (!path.startsWith(prefix)) continue;
      if (!authorize(deps, tokenFromRequest(req, url), ip)) return json(res, 401, { error: "unauthorized" }, cors);
      const r = await handler(decodeURIComponent(path.slice(prefix.length)));
      if (!r) res.writeHead(404, cors).end();
      else
        res
          .writeHead(200, {
            ...cors,
            "content-type": r.mime,
            "content-length": String(r.data.byteLength),
            "cache-control": `private, max-age=${r.maxAgeS ?? 0}`,
          })
          .end(req.method === "HEAD" ? undefined : r.data);
      return;
    }
    if (tilesRoot && path.startsWith("/tiles/")) {
      if (!authorize(deps, tokenFromRequest(req, url), ip)) return json(res, 401, { error: "unauthorized" }, cors);
      let name: string;
      try {
        name = decodeURIComponent(path.slice(7));
      } catch {
        res.writeHead(400).end();
        return;
      }
      // kafle, projection.json, route-places.json oraz ikony POI mapy (icons/<sprite>.png)
      if (!/^(icons\/)?[\w.-]+\.(pmtiles|json|png)$/.test(name) || name.includes("..")) {
        res.writeHead(404).end();
        return;
      }
      return sendFile(req, res, join(tilesRoot, name), { ...cors, "cache-control": "private, max-age=86400" });
    }

    if (!staticRoot) {
      res
        .writeHead(200, { "content-type": "text/plain; charset=utf-8" })
        .end("yoga-auto bridge działa. Zbuduj PWA: npm run build:app");
      return;
    }
    let rel: string;
    try {
      rel = decodeURIComponent(path);
    } catch {
      res.writeHead(400).end();
      return;
    }
    let file = join(staticRoot, rel);
    if (file !== staticRoot && !file.startsWith(staticRoot + sep)) {
      res.writeHead(400).end();
      return;
    }
    const exists = existsSync(file) && statSync(file).isFile();
    if (!exists) {
      // brakujący plik z rozszerzeniem = 404 (nie podsuwamy index.html jako JS/CSS); reszta = fallback SPA
      if (extname(rel)) {
        res.writeHead(404).end();
        return;
      }
      file = join(staticRoot, "index.html");
      if (!existsSync(file)) {
        res.writeHead(404).end();
        return;
      }
    }
    const immutable = path.startsWith("/assets/");
    return sendFile(req, res, file, {
      "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
    });
  };

  async function api(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    cors: Record<string, string>,
    ip: string | undefined,
  ): Promise<void> {
    const path = url.pathname;
    if (path === "/api/info" && req.method === "GET") {
      const dev = authorize(deps, tokenFromRequest(req, url), ip);
      const info: InfoRes = {
        name: "yoga-auto-bridge",
        version: deps.version,
        protocol: { major: PROTOCOL_VERSION, minor: PROTOCOL_MINOR },
        paired: dev !== null,
      };
      return json(res, 200, info, cors);
    }
    if (path === "/api/jobs" && req.method === "GET") {
      if (!deps.jobs) return json(res, 404, { error: "not_found" }, cors);
      if (!authorize(deps, tokenFromRequest(req, url), ip)) return json(res, 401, { error: "unauthorized" }, cors);
      const n = Number(url.searchParams.get("limit"));
      return json(res, 200, deps.jobs(Number.isInteger(n) && n > 0 ? Math.min(n, 1000) : 200), cors);
    }
    if (path === "/api/pair/start" && req.method === "POST") {
      if (!deps.pairing) return json(res, 404, { error: "pairing_disabled" }, cors);
      const r = deps.pairing.start(ip ?? null);
      if (!r.ok) return json(res, 429, { error: r.error }, { ...cors, "retry-after": "10" });
      const body: PairStartRes = { requestId: r.requestId, expiresIn: r.expiresIn };
      return json(res, 200, body, cors);
    }
    if (path === "/api/pair/confirm" && req.method === "POST") {
      if (!deps.pairing) return json(res, 404, { error: "pairing_disabled" }, cors);
      const body = (await readJson(req)) as Partial<PairConfirmReq> | null;
      if (!body || typeof body !== "object") return json(res, 400, { error: "bad_request" }, cors);
      const r = deps.pairing.confirm(body, ip ?? null);
      if (r.ok) deps.log("info", `device paired from ${ip}`);
      return json(res, r.ok ? 200 : r.error === "too_many_attempts" ? 429 : 400, r, cors);
    }
    return json(res, 404, { error: "not_found" }, cors);
  }
}

/** Plik z ETag, `Range` i 304. */
export function sendFile(req: IncomingMessage, res: ServerResponse, file: string, extra: Record<string, string> = {}): void {
  let st: Stats;
  try {
    st = statSync(file);
    if (!st.isFile()) throw new Error("not a file");
  } catch {
    res.writeHead(404).end();
    return;
  }
  const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
  const headers: Record<string, string> = {
    "content-type": MIME[extname(file).toLowerCase()] ?? "application/octet-stream",
    "accept-ranges": "bytes",
    etag,
    "last-modified": st.mtime.toUTCString(),
    ...extra,
  };
  if (req.headers["if-none-match"] === etag) {
    res.writeHead(304, headers).end();
    return;
  }
  let start = 0;
  let end = st.size - 1;
  let status = 200;
  const range = req.headers.range;
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (!m || (m[1] === "" && m[2] === "")) {
      res.writeHead(416, { "content-range": `bytes */${st.size}` }).end();
      return;
    }
    if (m[1] === "") {
      const n = Number(m[2]);
      start = Math.max(0, st.size - n);
    } else {
      start = Number(m[1]);
      if (m[2] !== "") end = Math.min(end, Number(m[2]));
    }
    if (start > end || start >= st.size) {
      res.writeHead(416, { "content-range": `bytes */${st.size}` }).end();
      return;
    }
    status = 206;
    headers["content-range"] = `bytes ${start}-${end}/${st.size}`;
  }
  headers["content-length"] = String(end - start + 1);
  res.writeHead(status, headers);
  if (req.method === "HEAD" || st.size === 0) {
    res.end();
    return;
  }
  const stream = createReadStream(file, { start, end });
  stream.on("error", () => res.destroy());
  res.on("close", () => stream.destroy());
  stream.pipe(res);
}
