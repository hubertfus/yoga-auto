import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { createMockSource } from "@yoga-auto/mock";
import {
  WS_SUBPROTOCOL,
  WsCloseCode,
  type InfoRes,
  type PairConfirmRes,
  type PairStartRes,
} from "@yoga-auto/protocol";
import { hostAllowed, isPrivateAddress, originAllowed } from "../src/access.ts";
import { DeviceStore } from "../src/devices.ts";
import { MAX_PIN_ATTEMPTS, PIN_TTL_S, PairingManager, type PinAnnouncement } from "../src/pairing.ts";
import { startBridge } from "../src/server.ts";
import { TestClient, sleep } from "./ws-client.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "yoga-auto-test-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("filtr adresów i nagłówków", () => {
  it("isPrivateAddress", () => {
    for (const ok of [
      "127.0.0.1",
      "127.9.9.9",
      "10.0.0.5",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.20",
      "169.254.3.4",
      "::1",
      "::ffff:192.168.0.7",
      "fe80::1",
      "fe80::1%12",
      "febf::1",
      "fc00::1",
      "fd12:3456::1",
    ])
      expect(isPrivateAddress(ok), ok).toBe(true);
    for (const bad of [
      undefined,
      "",
      "8.8.8.8",
      "172.15.0.1",
      "172.32.0.1",
      "192.169.0.1",
      "11.0.0.1",
      "169.253.1.1",
      "2001:db8::1",
      "fec0::1",
      "fe00::1",
      "::ffff:8.8.8.8",
      "abc",
      "300.1.1.1",
    ])
      expect(isPrivateAddress(bad), String(bad)).toBe(false);
  });

  it("hostAllowed: IP prywatne, localhost, *.local, własna nazwa; nie: domena z internetu (DNS rebinding)", () => {
    const policy = { ownHostnames: ["gamer-pc"] };
    for (const h of ["192.168.1.5:7420", "localhost:7420", "[::1]:7420", "pc.local:7420", "gamer-pc:7420"])
      expect(hostAllowed(h, policy), h).toBe(true);
    for (const h of ["evil.example:7420", "8.8.8.8", undefined, "gamer-pc.evil.com"])
      expect(hostAllowed(h, policy), String(h)).toBe(false);
    expect(hostAllowed("my.lan", { extraHosts: ["my.lan"] })).toBe(true);
  });

  it("originAllowed: brak Origin ok; obce witryny odrzucone", () => {
    expect(originAllowed(undefined, "192.168.1.5:7420")).toBe(true);
    expect(originAllowed("http://192.168.1.5:7420", "192.168.1.5:7420")).toBe(true);
    expect(originAllowed("http://localhost:5173", "192.168.1.5:7420")).toBe(true);
    expect(originAllowed("http://pc.local:7420", "192.168.1.5:7420")).toBe(true);
    expect(originAllowed("https://evil.example", "192.168.1.5:7420")).toBe(false);
    expect(originAllowed("null", "192.168.1.5:7420")).toBe(false);
    expect(originAllowed("not a url", "192.168.1.5:7420")).toBe(false);
  });
});

describe("DeviceStore", () => {
  it("token działa po restarcie, plik nie zawiera tokenu, tylko skrót", () => {
    const a = new DeviceStore(dir);
    const { token, device } = a.add("Yoga", "192.168.1.9");
    a.close();
    const raw = readFileSync(join(dir, "devices.json"), "utf8");
    expect(raw).not.toContain(token);
    const b = new DeviceStore(dir);
    expect(b.verify(token)?.id).toBe(device.id);
    expect(b.verify(token + "x")).toBeNull();
    expect(b.verify(undefined)).toBeNull();
    expect(b.list().map((d) => d.name)).toEqual(["Yoga"]);
  });

  it("revoke po id i po nazwie; revoke-all", () => {
    const a = new DeviceStore(dir);
    const t1 = a.add("Yoga");
    const t2 = a.add("Telefon");
    a.add("Telefon");
    expect(a.revoke("Telefon")).toBeNull(); // niejednoznaczna nazwa
    expect(a.revoke(t1.device.id)?.name).toBe("Yoga");
    expect(a.verify(t1.token)).toBeNull();
    expect(a.verify(t2.token)).not.toBeNull();
    expect(a.revokeAll()).toBe(2);
  });

  it("reloadIfChanged widzi odwołanie z innego procesu", () => {
    const a = new DeviceStore(dir);
    const { token, device } = a.add("Yoga");
    const cli = new DeviceStore(dir); // „proces CLI”
    expect(cli.revoke(device.id)).not.toBeNull();
    expect(a.reloadIfChanged()).toEqual([device.id]);
    expect(a.verify(token)).toBeNull();
    expect(a.reloadIfChanged()).toEqual([]);
  });

  it("zaległy zapis lastSeen nie nadpisuje odwołania z CLI; add po zmianie zewnętrznej zachowuje oba", () => {
    const a = new DeviceStore(dir);
    const t1 = a.add("Yoga");
    expect(a.verify(t1.token)).not.toBeNull(); // → zaległy zapis lastSeen (dirty)
    const cli = new DeviceStore(dir);
    cli.revoke(t1.device.id);
    const t2 = cli.add("Telefon");
    a.close(); // flush zaległego lastSeen nie może wskrzesić odwołanego urządzenia
    const fresh = new DeviceStore(dir);
    expect(fresh.list().map((d) => d.name)).toEqual(["Telefon"]);
    expect(fresh.verify(t1.token)).toBeNull();
    expect(fresh.verify(t2.token)).not.toBeNull();
    const t3 = a.add("Trzeci"); // a widzi zmianę zewnętrzną przed dopisaniem
    expect(new DeviceStore(dir).list().map((d) => d.name)).toEqual(["Telefon", "Trzeci"]);
    expect(t3.device.name).toBe("Trzeci");
  });

  it("uszkodzony plik nie wywala bridge'a i nie jest kasowany", () => {
    writeFileSync(join(dir, "devices.json"), "{ nie json");
    const a = new DeviceStore(dir);
    expect(a.list()).toEqual([]);
    expect(readFileSync(join(dir, "devices.json"), "utf8")).toBe("{ nie json");
  });

  it("nazwa urządzenia jest czyszczona i ograniczona", () => {
    const a = new DeviceStore(dir);
    expect(a.add("  Yo\u0000ga\n ").device.name).toBe("Yoga");
    expect(a.add("").device.name).toBe("Urządzenie");
    expect(a.add("x".repeat(500)).device.name).toHaveLength(64);
  });
});

describe("PairingManager", () => {
  function setup() {
    let now = 1_000_000;
    const devices = new DeviceStore(dir);
    const pins: PinAnnouncement[] = [];
    const pm = new PairingManager(devices, (a) => pins.push(a), () => now);
    return { devices, pins, pm, tick: (ms: number) => (now += ms) };
  }
  const start = (pm: PairingManager) => {
    const r = pm.start("192.168.1.9");
    if (!r.ok) throw new Error("rate limited");
    return r;
  };

  it("PIN 6 cyfr, pokazany tylko przez announce; poprawny PIN daje działający token", () => {
    const { pm, pins, devices } = setup();
    const r = start(pm);
    expect(pins[0]!.pin).toMatch(/^\d{6}$/);
    expect(pins[0]!.expiresIn).toBe(PIN_TTL_S);
    expect(JSON.stringify(r)).not.toContain(pins[0]!.pin);
    const c = pm.confirm({ requestId: r.requestId, pin: pins[0]!.pin, deviceName: "Yoga" });
    expect(c.ok).toBe(true);
    expect(devices.verify(c.token)?.name).toBe("Yoga");
    expect(Buffer.from(c.token!, "base64url")).toHaveLength(32);
  });

  it("zły PIN → invalid_pin; po 5 błędach too_many_attempts i prośba unieważniona (nawet z dobrym PIN-em)", () => {
    const { pm, pins } = setup();
    const r = start(pm);
    const wrong = pins[0]!.pin === "000000" ? "111111" : "000000";
    for (let i = 1; i < MAX_PIN_ATTEMPTS; i++)
      expect(pm.confirm({ requestId: r.requestId, pin: wrong, deviceName: "x" }).error).toBe("invalid_pin");
    expect(pm.confirm({ requestId: r.requestId, pin: wrong, deviceName: "x" }).error).toBe("too_many_attempts");
    expect(pm.confirm({ requestId: r.requestId, pin: pins[0]!.pin, deviceName: "x" }).error).toBe("expired");
  });

  it("PIN wygasa po 120 s; PIN jednorazowy; nieznany requestId = expired", () => {
    const { pm, pins, tick } = setup();
    const r = start(pm);
    tick(PIN_TTL_S * 1000 + 1);
    expect(pm.confirm({ requestId: r.requestId, pin: pins[0]!.pin, deviceName: "x" }).error).toBe("expired");
    const r2 = start(pm);
    expect(pm.confirm({ requestId: r2.requestId, pin: pins[1]!.pin, deviceName: "x" }).ok).toBe(true);
    expect(pm.confirm({ requestId: r2.requestId, pin: pins[1]!.pin, deviceName: "x" }).error).toBe("expired");
    expect(pm.confirm({ requestId: "nope", pin: "123456", deviceName: "x" }).error).toBe("expired");
    expect(pm.confirm(null).error).toBe("expired");
  });

  it("limit startów (6/min) i maks. 3 otwarte prośby", () => {
    const { pm, tick } = setup();
    const ids = [1, 2, 3, 4].map(() => start(pm).requestId);
    expect(pm.confirm({ requestId: ids[0]!, pin: "000000", deviceName: "x" }).error).toBe("expired"); // wyparta
    start(pm);
    start(pm);
    expect(pm.start().ok).toBe(false);
    tick(61_000);
    expect(pm.start().ok).toBe(true);
  });
});

describe("serwer: auth, parowanie, origin", () => {
  type Bridge = Awaited<ReturnType<typeof startBridge>>;
  const open: { close(): unknown }[] = [];
  afterEach(async () => {
    for (const o of open.splice(0).reverse()) await o.close();
  });

  async function boot(extra: Partial<Parameters<typeof startBridge>[0]> = {}, pins: PinAnnouncement[] = []) {
    const b = await startBridge({
      source: createMockSource(),
      port: 0,
      host: "127.0.0.1",
      auth: true,
      devices: new DeviceStore(dir),
      onPin: (a) => pins.push(a),
      log: () => {},
      ...extra,
    });
    open.push(b);
    return b;
  }

  const base = (b: Bridge) => `http://127.0.0.1:${b.port}`;
  const post = (b: Bridge, path: string, body: unknown) =>
    fetch(base(b) + path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  async function pair(b: Bridge, pins: PinAnnouncement[], name = "Yoga"): Promise<string> {
    const s = (await (await post(b, "/api/pair/start", {})).json()) as PairStartRes;
    const c = (await (
      await post(b, "/api/pair/confirm", { requestId: s.requestId, pin: pins.at(-1)!.pin, deviceName: name })
    ).json()) as PairConfirmRes;
    expect(c.ok).toBe(true);
    return c.token!;
  }

  const raw = (b: Bridge, opts: { path: string; headers: Record<string, string>; method?: string }) =>
    new Promise<{ status: number; body: string }>((res, rej) => {
      const r = request(
        { host: "127.0.0.1", port: b.port, path: opts.path, method: opts.method ?? "GET", headers: opts.headers },
        (resp) => {
          let body = "";
          resp.on("data", (d) => (body += d));
          resp.on("end", () => res({ status: resp.statusCode ?? 0, body }));
        },
      );
      r.on("error", rej);
      r.end();
    });

  it("WS bez tokenu i ze złym tokenem → 4003", async () => {
    const b = await boot();
    const none = new TestClient(b.port);
    expect(await none.closed()).toBe(WsCloseCode.Unauthorized);
    const bad = new TestClient(b.port, [WS_SUBPROTOCOL, "token.AAAA"]);
    expect(await bad.closed()).toBe(WsCloseCode.Unauthorized);
  });

  it("brak subprotokołu yoga-auto.v1 → odmowa (4001 albo zerwanie)", async () => {
    const b = await boot();
    const c = new TestClient(b.port, ["inny.v9"]);
    const code = await c.closed();
    expect([WsCloseCode.ProtocolMismatch, 1002, 1005, 1006]).toContain(code);
  });

  it("pełne parowanie przez HTTP → WS działa; restart bridge'a nie wymaga ponownego parowania", async () => {
    const pins: PinAnnouncement[] = [];
    const b1 = await boot({}, pins);
    const info0 = (await (await fetch(base(b1) + "/api/info")).json()) as InfoRes;
    expect(info0.paired).toBe(false);
    const token = await pair(b1, pins);
    const info1 = (await (
      await fetch(base(b1) + "/api/info", { headers: { authorization: `Bearer ${token}` } })
    ).json()) as InfoRes;
    expect(info1.paired).toBe(true);
    const c1 = new TestClient(b1.port, [WS_SUBPROTOCOL, `token.${token}`]);
    await c1.opened();
    await c1.next("hello");
    c1.close();
    await b1.close();
    open.length = 0;

    const b2 = await boot(); // ten sam katalog danych, nowy proces/sesja
    const c2 = new TestClient(b2.port, [WS_SUBPROTOCOL, `token.${token}`]);
    await c2.opened();
    const hello = await c2.next("hello");
    expect(hello.session).toBeTruthy();
    c2.close();
  });

  it("confirm: zły PIN 400, wyczerpane próby 429, nie-JSON 400; odpowiedź start nie zdradza PIN-u", async () => {
    const pins: PinAnnouncement[] = [];
    const b = await boot({}, pins);
    const sj = (await (await post(b, "/api/pair/start", {})).json()) as PairStartRes;
    expect(JSON.stringify(sj)).not.toContain(pins[0]!.pin);
    const wrong = pins[0]!.pin === "000000" ? "111111" : "000000";
    const body = { requestId: sj.requestId, pin: wrong, deviceName: "x" };
    expect((await post(b, "/api/pair/confirm", body)).status).toBe(400);
    for (let i = 0; i < 3; i++) await post(b, "/api/pair/confirm", body);
    expect((await post(b, "/api/pair/confirm", body)).status).toBe(429);
    expect((await fetch(base(b) + "/api/pair/confirm", { method: "POST", body: "pin=1" })).status).toBe(400);
  });

  it("Origin z obcej witryny: /api i WS odrzucone; Host z internetu → 421 (DNS rebinding)", async () => {
    const b = await boot();
    const host = `127.0.0.1:${b.port}`;
    expect((await raw(b, { path: "/api/info", headers: { origin: "https://evil.example", host } })).status).toBe(403);
    expect((await raw(b, { path: "/api/info", headers: { host: "evil.example" } })).status).toBe(421);
    expect((await raw(b, { path: "/api/info", headers: { origin: `http://${host}`, host } })).status).toBe(200);
    const pre = await raw(b, {
      path: "/api/pair/start",
      method: "OPTIONS",
      headers: { origin: "http://localhost:5173", host },
    });
    expect(pre.status).toBe(204);

    const err = await new Promise<string>((res) => {
      const ws = new WebSocket(`ws://${host}/ws`, [WS_SUBPROTOCOL], { origin: "https://evil.example" });
      ws.on("error", (e) => res(String(e.message)));
      ws.on("open", () => res("opened"));
    });
    expect(err).toMatch(/403/);
    const rebindErr = await new Promise<string>((res) => {
      const ws = new WebSocket(`ws://${host}/ws`, [WS_SUBPROTOCOL], { headers: { host: "evil.example" } });
      ws.on("error", (e) => res(String(e.message)));
      ws.on("open", () => res("opened"));
    });
    expect(rebindErr).toMatch(/421/);
  });

  it("zasoby modułów wymagają tokenu (?k= albo Bearer)", async () => {
    const pins: PinAnnouncement[] = [];
    const mod = {
      name: "art",
      async start(ctx: { registerStatic: (p: string, h: () => Promise<{ mime: string; data: Uint8Array } | null>) => void }) {
        ctx.registerStatic("/media/art/", async () => ({ mime: "image/jpeg", data: new Uint8Array([1, 2, 3]) }));
      },
      async stop() {},
    };
    const b = await boot({ modules: [mod as never] }, pins);
    expect((await fetch(base(b) + "/media/art/x.jpg")).status).toBe(401);
    const token = await pair(b, pins);
    expect((await fetch(base(b) + `/media/art/x.jpg?k=${token}`)).status).toBe(200);
    expect(
      (await fetch(base(b) + "/media/art/x.jpg", { headers: { authorization: `Bearer ${token}` } })).status,
    ).toBe(200);
    expect((await fetch(base(b) + "/media/art/x.jpg?k=zly")).status).toBe(401);
  });

  it("odwołanie urządzenia (CLI) rozłącza klienta kodem 4003 i blokuje ponowne połączenie", async () => {
    const pins: PinAnnouncement[] = [];
    const b = await boot({ devicePollMs: 50 }, pins);
    const token = await pair(b, pins, "Do odwołania");
    const c = new TestClient(b.port, [WS_SUBPROTOCOL, `token.${token}`]);
    await c.opened();
    await c.next("hello");
    const cli = new DeviceStore(dir);
    const id = cli.list()[0]!.id;
    expect(cli.revoke(id)).not.toBeNull();
    expect(await c.closed()).toBe(WsCloseCode.Unauthorized);
    await sleep(10);
    const again = new TestClient(b.port, [WS_SUBPROTOCOL, `token.${token}`]);
    expect(await again.closed()).toBe(WsCloseCode.Unauthorized);
  });

  it("auth: true bez DeviceStore → błąd konfiguracji", async () => {
    await expect(
      startBridge({ source: createMockSource(), port: 0, host: "127.0.0.1", auth: true, log: () => {} }),
    ).rejects.toThrow(/devices/);
  });
});
