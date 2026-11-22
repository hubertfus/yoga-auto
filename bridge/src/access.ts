/**
 * Kontrola dostępu: filtr adresów źródłowych (ADR-009 / PROTOCOL.md §6) i sprawdzanie `Origin`.
 */
import { isIP } from "node:net";

/** Adres źródłowy musi być: 127/8, 10/8, 172.16/12, 192.168/16, 169.254/16, ::1, fe80::/10, fc00::/7. */
export function isPrivateAddress(addr: string | undefined): boolean {
  if (!addr) return false;
  let a = addr.trim().toLowerCase();
  const zone = a.indexOf("%");
  if (zone >= 0) a = a.slice(0, zone);
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(a);
  if (mapped) a = mapped[1]!;
  const kind = isIP(a);
  if (kind === 4) {
    const [p, q] = a.split(".").map(Number) as [number, number];
    return (
      p === 127 || p === 10 || (p === 192 && q === 168) || (p === 169 && q === 254) || (p === 172 && q >= 16 && q <= 31)
    );
  }
  if (kind === 6) {
    if (a === "::1") return true;
    const first = parseInt(a.split(":")[0] || "0", 16);
    if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10
    return (first & 0xfe00) === 0xfc00; // fc00::/7
  }
  return false;
}

/** Host z nagłówka `Host` / `Origin` bez portu i nawiasów IPv6. */
export function hostOf(hostPort: string): string {
  const h = hostPort.trim().toLowerCase();
  if (h.startsWith("[")) return h.slice(1, h.indexOf("]"));
  const i = h.lastIndexOf(":");
  return i > 0 && !h.includes("::") ? h.slice(0, i) : h;
}

export interface OriginPolicy {
  /** dodatkowe dozwolone hosty (np. własna domena w LAN) */
  extraHosts?: readonly string[];
  /** nazwy tego komputera (hostname, hostname.local) — małe litery */
  ownHostnames?: readonly string[];
}

/**
 * Nagłówek `Host` musi wskazywać ten bridge: literał adresu prywatnego, `localhost`, `*.local`, nazwę komputera
 * albo host z konfiguracji. To zamyka atak DNS rebinding (złośliwa domena rozwiązana na adres LAN).
 */
export function hostAllowed(hostHeader: string | undefined, policy: OriginPolicy = {}): boolean {
  if (!hostHeader) return false;
  const h = hostOf(hostHeader);
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local")) return true;
  if (policy.ownHostnames?.includes(h) || policy.extraHosts?.includes(h)) return true;
  return isIP(h) !== 0 && isPrivateAddress(h);
}

/**
 * Czy nagłówek `Origin` jest akceptowalny.
 * - brak `Origin` → klient niebrowserowy (skrypt, test) → OK (token i tak obowiązuje);
 * - host Origin = host z `Host` (ta sama witryna), literał adresu prywatnego, `localhost`, `*.local`, `*.localhost`.
 * Strona z internetu (np. https://evil.example) dostaje odmowę, więc złośliwa karta w przeglądarce
 * na tym samym PC/LAN nie może rozmawiać z bridge'em.
 */
export function originAllowed(origin: string | undefined, hostHeader: string | undefined, policy: OriginPolicy = {}): boolean {
  if (origin === undefined) return true;
  if (origin === "null") return false;
  let host: string;
  try {
    host = new URL(origin).hostname.toLowerCase().replace(/^\[|\]$/g, "");
  } catch {
    return false;
  }
  if (hostHeader && host === hostOf(hostHeader)) return true;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (policy.extraHosts?.includes(host)) return true;
  return isIP(host) !== 0 && isPrivateAddress(host);
}
