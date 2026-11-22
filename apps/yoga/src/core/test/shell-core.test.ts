// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, getSettings, resetSettings, updateSettings } from "../settings.ts";
import { HOME, back, getRoute, navigate } from "../router.ts";
import { PairingHttpError, fetchInfo, pairConfirm, pairStart } from "../pairing.ts";
import { getToken, setToken } from "../client.ts";
import { gateFor } from "../../shell/gate.ts";
import { installWakeLock } from "../../shell/kiosk.ts";

describe("settings", () => {
  beforeEach(() => resetSettings());
  it("scala jednostki częściowo i zapisuje w localStorage", () => {
    updateSettings({ units: { speed: "mph" }, fastHz: 60, night: true });
    expect(getSettings().units).toEqual({ ...DEFAULT_SETTINGS.units, speed: "mph" });
    const saved = JSON.parse(localStorage.getItem("yoga-auto.settings.v1")!);
    expect(saved.fastHz).toBe(60);
    expect(saved.night).toBe(true);
  });
  it("reset przywraca domyślne", () => {
    updateSettings({ theme: "light", tier: "flat" });
    resetSettings();
    expect(getSettings()).toEqual(DEFAULT_SETTINGS);
  });
});

describe("router", () => {
  it("navigate/back", () => {
    navigate(HOME);
    navigate("drive");
    navigate("vehicle");
    expect(getRoute()).toBe("vehicle");
    back();
    expect(getRoute()).toBe("drive");
    navigate(HOME);
  });
});

describe("gate", () => {
  it("mapuje stan połączenia", () => {
    expect(gateFor("unauthorized")).toBe("pairing");
    expect(gateFor("open")).toBe("ready");
    expect(gateFor("connecting")).toBe("connecting");
  });
});

describe("pairing HTTP", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setToken(null);
  });
  const json = (status: number, body: unknown) => ({ ok: status < 400, status, text: async () => JSON.stringify(body), json: async () => body });

  it("start → confirm zwraca token, który można zapisać", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(200, { requestId: "r1", expiresIn: 120 }))
      .mockResolvedValueOnce(json(200, { ok: true, token: "tok" }));
    vi.stubGlobal("fetch", fetchMock);
    const start = await pairStart();
    const res = await pairConfirm({ requestId: start.requestId, pin: "123456", deviceName: "x" });
    expect(res).toEqual({ ok: true, token: "tok" });
    setToken(res.token!);
    expect(getToken()).toBe("tok");
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/pair/start");
  });
  it("błędny PIN (4xx z ciałem) jest zwracany, nie rzucany", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(401, { ok: false, error: "invalid_pin" })));
    expect((await pairConfirm({ requestId: "r", pin: "000000", deviceName: "x" })).error).toBe("invalid_pin");
  });
  it("pusta odpowiedź → PairingHttpError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => "" }));
    await expect(pairStart()).rejects.toBeInstanceOf(PairingHttpError);
  });
  it("fetchInfo: null przy błędzie sieci, token w nagłówku", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("net")));
    expect(await fetchInfo()).toBeNull();
    setToken("abc");
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ paired: true }) });
    vi.stubGlobal("fetch", f);
    await fetchInfo();
    expect(f.mock.calls[0]![1].headers.authorization).toBe("Bearer abc");
  });
});

describe("wake lock", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("żąda blokady i ponawia po visibilitychange", async () => {
    let released: (() => void) | null = null;
    const request = vi.fn(async () => {
      const s = { released: false, release: async () => void (s.released = true), addEventListener: (_: string, cb: () => void) => (released = cb) };
      return s;
    });
    Object.defineProperty(navigator, "wakeLock", { value: { request }, configurable: true });
    const states: boolean[] = [];
    const off = installWakeLock((a) => states.push(a));
    await vi.waitFor(() => expect(states).toContain(true));
    expect(request).toHaveBeenCalledTimes(1);
    released!(); // system zwolnił
    expect(states.at(-1)).toBe(false);
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    off();
    Object.defineProperty(navigator, "wakeLock", { value: undefined, configurable: true });
  });
});
