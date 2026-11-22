/**
 * Sparowane urządzenia: `%APPDATA%\yoga-auto\devices.json`.
 *
 * Plik NIE zawiera tokenów, tylko ich skrót SHA-256 (wyciek pliku ≠ możliwość połączenia). Token (32 B, base64url)
 * ma pełną entropię, więc zwykły skrót wystarcza (nie trzeba KDF). Restart bridge'a nie wymaga ponownego parowania.
 * Zapis atomowy (temp + rename). CLI (`bridge devices revoke`) to osobny proces: działający bridge odświeża plik
 * przez `reloadIfChanged()` i rozłącza odwołane urządzenia.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface DeviceRecord {
  id: string;
  name: string;
  /** SHA-256 (hex) tokenu */
  tokenHash: string;
  createdAt: number;
  lastSeenAt: number | null;
  lastIp: string | null;
}

interface DevicesFile {
  version: 1;
  devices: DeviceRecord[];
}

export const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");

export class DeviceStore {
  readonly file: string;
  private byHash = new Map<string, DeviceRecord>();
  private mtimeMs = 0;
  private dirty = false;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly now: () => number;

  constructor(dir: string, now: () => number = Date.now) {
    this.file = join(dir, "devices.json");
    this.now = now;
    this.load();
  }

  list(): DeviceRecord[] {
    return [...this.byHash.values()].sort((a, b) => a.createdAt - b.createdAt);
  }

  /** Utwórz urządzenie i zwróć surowy token (jedyny moment, kiedy istnieje w całości po stronie bridge'a). */
  add(name: string, ip: string | null = null): { device: DeviceRecord; token: string } {
    this.syncFromDisk();
    const token = randomBytes(32).toString("base64url");
    const device: DeviceRecord = {
      id: randomUUID().slice(0, 8),
      name: cleanName(name),
      tokenHash: hashToken(token),
      createdAt: this.now(),
      lastSeenAt: null,
      lastIp: ip,
    };
    this.byHash.set(device.tokenHash, device);
    this.flush();
    return { device, token };
  }

  /** Sprawdź token. Zapis `lastSeen` jest odroczony (nie męczymy dysku przy każdym połączeniu). */
  verify(token: string | undefined, ip?: string): DeviceRecord | null {
    if (!token || token.length > 200) return null;
    const d = this.byHash.get(hashToken(token));
    if (!d) return null;
    d.lastSeenAt = this.now();
    if (ip) d.lastIp = ip;
    this.scheduleFlush();
    return d;
  }

  /** Odwołaj po id lub (jednoznacznej) nazwie. Zwraca usunięty rekord. */
  revoke(idOrName: string): DeviceRecord | null {
    this.syncFromDisk();
    const list = this.list();
    const byId = list.find((d) => d.id === idOrName);
    const byName = list.filter((d) => d.name === idOrName);
    const target = byId ?? (byName.length === 1 ? byName[0]! : null);
    if (!target) return null;
    this.byHash.delete(target.tokenHash);
    this.flush();
    return target;
  }

  revokeAll(): number {
    this.syncFromDisk();
    const n = this.byHash.size;
    this.byHash.clear();
    this.flush();
    return n;
  }

  /**
   * Czy plik zmienił się na dysku (np. CLI odwołało urządzenie) → przeładuj, zachowując nasze zaległe `lastSeen`.
   * Zwraca id urządzeń, które zniknęły (odwołane).
   */
  reloadIfChanged(): string[] {
    if (this.diskMtime() === this.mtimeMs) return [];
    return this.mergeExternal();
  }

  /** Zapisz zaległe zmiany (lastSeen). */
  close(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    if (this.dirty) this.flush();
  }

  private load(): void {
    this.byHash.clear();
    if (!existsSync(this.file)) {
      this.mtimeMs = 0;
      return;
    }
    try {
      const data = JSON.parse(readFileSync(this.file, "utf8")) as Partial<DevicesFile>;
      for (const d of data.devices ?? [])
        if (d && typeof d.tokenHash === "string" && typeof d.id === "string")
          this.byHash.set(d.tokenHash, {
            id: d.id,
            name: cleanName(d.name ?? ""),
            tokenHash: d.tokenHash,
            createdAt: Number(d.createdAt) || 0,
            lastSeenAt: typeof d.lastSeenAt === "number" ? d.lastSeenAt : null,
            lastIp: typeof d.lastIp === "string" ? d.lastIp : null,
          });
      this.mtimeMs = statSync(this.file).mtimeMs;
    } catch {
      // uszkodzony plik: nie kasujemy go (zachowaj do ręcznej naprawy), zaczynamy od pustej listy
      this.mtimeMs = existsSync(this.file) ? statSync(this.file).mtimeMs : 0;
    }
  }

  /** Przed zmianą listy: uwzględnij to, co ktoś inny zapisał w międzyczasie. */
  private syncFromDisk(): void {
    if (this.diskMtime() !== this.mtimeMs) this.mergeExternal();
  }

  private diskMtime(): number {
    try {
      return statSync(this.file).mtimeMs;
    } catch {
      return 0;
    }
  }

  /** Wczytaj plik z dysku jako prawdę o liście urządzeń, ale zachowaj świeższe `lastSeen` z pamięci. */
  private mergeExternal(): string[] {
    const before = new Map([...this.byHash.values()].map((d) => [d.tokenHash, d] as const));
    this.load();
    for (const d of this.byHash.values()) {
      const mine = before.get(d.tokenHash);
      if (mine && (mine.lastSeenAt ?? 0) > (d.lastSeenAt ?? 0)) {
        d.lastSeenAt = mine.lastSeenAt;
        d.lastIp = mine.lastIp;
      }
    }
    return [...before.values()].filter((d) => !this.byHash.has(d.tokenHash)).map((d) => d.id);
  }

  private flush(): void {
    // ktoś (CLI) zmienił plik od naszego ostatniego odczytu/zapisu: nie nadpisuj jego zmian (np. odwołań)
    this.syncFromDisk();
    this.dirty = false;
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    const body: DevicesFile = { version: 1, devices: this.list() };
    writeFileSync(tmp, JSON.stringify(body, null, 2), "utf8");
    renameSync(tmp, this.file);
    this.mtimeMs = statSync(this.file).mtimeMs;
  }

  private scheduleFlush(): void {
    this.dirty = true;
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      if (this.dirty) this.flush();
    }, 30_000);
    this.flushTimer.unref?.();
  }
}

function cleanName(name: string): string {
  // eslint-disable-next-line no-control-regex
  const n = name.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 64);
  return n || "Urządzenie";
}
