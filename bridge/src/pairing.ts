/**
 * Parowanie PIN (ADR-009, PROTOCOL.md §6):
 *  start → bridge generuje PIN 6 cyfr i pokazuje go TYLKO na PC (konsola/tray), zwraca `requestId`;
 *  confirm → UI przesyła PIN wpisany dotykiem; ≤ 5 prób na `requestId`, PIN ważny 120 s; wynik = token urządzenia.
 */
import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import type { PairConfirmReq, PairConfirmRes, PairStartRes } from "@yoga-auto/protocol";
import type { DeviceStore } from "./devices.ts";

export const PIN_TTL_S = 120;
export const MAX_PIN_ATTEMPTS = 5;
/** Maks. jednocześnie otwartych próśb o parowanie (starsze są wypierane). */
const MAX_OPEN_REQUESTS = 3;
/** Maks. `pair/start` na minutę (ochrona przed zalewaniem konsoli PIN-ami). */
const MAX_STARTS_PER_MIN = 6;

export interface PinAnnouncement {
  pin: string;
  requestId: string;
  expiresIn: number;
  /** IP klienta, który poprosił o parowanie (żeby właściciel widział, kto prosi) */
  from: string | null;
}

interface Request {
  pin: string;
  expiresAt: number;
  attempts: number;
}

export type StartResult = ({ ok: true } & PairStartRes) | { ok: false; error: "rate_limited" };

export class PairingManager {
  private readonly requests = new Map<string, Request>();
  private starts: number[] = [];
  private readonly devices: DeviceStore;
  private readonly announce: (a: PinAnnouncement) => void;
  private readonly now: () => number;

  constructor(devices: DeviceStore, announce: (a: PinAnnouncement) => void, now: () => number = Date.now) {
    this.devices = devices;
    this.announce = announce;
    this.now = now;
  }

  start(from: string | null = null): StartResult {
    const t = this.now();
    this.starts = this.starts.filter((s) => t - s < 60_000);
    if (this.starts.length >= MAX_STARTS_PER_MIN) return { ok: false, error: "rate_limited" };
    this.starts.push(t);
    this.purge(t);
    while (this.requests.size >= MAX_OPEN_REQUESTS) this.requests.delete(this.requests.keys().next().value as string);
    const requestId = randomBytes(12).toString("base64url");
    const pin = String(randomInt(0, 1_000_000)).padStart(6, "0");
    this.requests.set(requestId, { pin, expiresAt: t + PIN_TTL_S * 1000, attempts: 0 });
    this.announce({ pin, requestId, expiresIn: PIN_TTL_S, from });
    return { ok: true, requestId, expiresIn: PIN_TTL_S };
  }

  confirm(req: Partial<PairConfirmReq> | null, ip: string | null = null): PairConfirmRes {
    const t = this.now();
    this.purge(t);
    const r = typeof req?.requestId === "string" ? this.requests.get(req.requestId) : undefined;
    if (!r || typeof req?.requestId !== "string") return { ok: false, error: "expired" };
    r.attempts++;
    if (r.attempts > MAX_PIN_ATTEMPTS) {
      this.requests.delete(req.requestId);
      return { ok: false, error: "too_many_attempts" };
    }
    if (!pinEquals(r.pin, typeof req.pin === "string" ? req.pin : "")) {
      if (r.attempts >= MAX_PIN_ATTEMPTS) {
        this.requests.delete(req.requestId);
        return { ok: false, error: "too_many_attempts" };
      }
      return { ok: false, error: "invalid_pin" };
    }
    this.requests.delete(req.requestId);
    const { token } = this.devices.add(typeof req.deviceName === "string" ? req.deviceName : "", ip);
    return { ok: true, token };
  }

  private purge(t: number): void {
    for (const [id, r] of this.requests) if (r.expiresAt <= t) this.requests.delete(id);
  }
}

function pinEquals(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
