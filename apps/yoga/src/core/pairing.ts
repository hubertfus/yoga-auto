/**
 * HTTP bridge'a (PROTOCOL.md §6): /api/info i parowanie PIN-em.
 * Token z /api/pair/confirm trafia do localStorage (`setToken`) i jest wysyłany jako subprotokół WS.
 * Do /api/info dokładamy token w nagłówku `Authorization: Bearer <token>` (auth opcjonalna → `paired`).
 * Właściciel: S4.
 */
import type { InfoRes, PairConfirmReq, PairConfirmRes, PairStartRes } from "@yoga-auto/protocol";
import { getToken } from "./client.ts";

export const INFO_TIMEOUT_MS = 2500;

async function withTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await run(ctrl.signal);
  } finally {
    clearTimeout(t);
  }
}

/** GET /api/info. `null` = bridge nieosiągalny (sieć, timeout, błąd HTTP). */
export async function fetchInfo(base = ""): Promise<InfoRes | null> {
  try {
    return await withTimeout(INFO_TIMEOUT_MS, async (signal) => {
      const token = getToken();
      const res = await fetch(`${base}/api/info`, {
        signal,
        cache: "no-store",
        headers: token ? { authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) return null;
      return (await res.json()) as InfoRes;
    });
  } catch {
    return null;
  }
}

export class PairingHttpError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`HTTP ${status}`);
    this.status = status;
  }
}

async function postJson<T>(path: string, body?: unknown): Promise<T> {
  return withTimeout(5000, async (signal) => {
    const res = await fetch(path, {
      method: "POST",
      signal,
      cache: "no-store",
      headers: { "content-type": "application/json" },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    // confirm zwraca 4xx z ciałem PairConfirmRes (np. invalid_pin) — czytamy JSON, jeśli jest.
    const text = await res.text();
    if (!text) throw new PairingHttpError(res.status);
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new PairingHttpError(res.status);
    }
  });
}

export const pairStart = (): Promise<PairStartRes> => postJson<PairStartRes>("/api/pair/start");

export const pairConfirm = (req: PairConfirmReq): Promise<PairConfirmRes> =>
  postJson<PairConfirmRes>("/api/pair/confirm", req);

/** Nazwa urządzenia pokazywana na PC w liście sparowanych. */
export function deviceName(): string {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /Mac/.test(ua) ? "Mac" : "urządzenie";
  return `yoga-auto (${os})`;
}
