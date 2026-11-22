import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HOLD_MAX_MS, HOLD_WATCHDOG_MS, SET_TIMEOUT_MS, type AckMsg, type ActionId, type CmdMsg } from "@yoga-auto/protocol";
import { RateLimiter } from "../src/ratelimit.ts";
import { SimSource } from "./simsource.ts";

let sim: SimSource;
let router: ReturnType<SimSource["attach"]>;

beforeEach(() => {
  vi.useFakeTimers();
  sim = new SimSource();
  router = sim.attach();
});
afterEach(() => vi.useRealTimers());

const cmd = (action: ActionId, extra: Partial<CmdMsg> = {}): CmdMsg => ({
  t: "cmd",
  id: `c${Math.random().toString(36).slice(2, 8)}`,
  action,
  ...extra,
});

/** Wyślij komendę i przesuwaj czas, aż ack wróci. */
async function run(c: CmdMsg, client = "A", maxMs = 5000): Promise<AckMsg> {
  const p = router.handle(c, client);
  let ack: AckMsg | null = null;
  void p.then((a) => (ack = a));
  for (let t = 0; t < maxMs && !ack; t += 4) await vi.advanceTimersByTimeAsync(4);
  if (!ack) throw new Error("brak ack");
  return ack;
}

describe("walidacja i stan gry", () => {
  it("unknown_action, invalid_value", async () => {
    expect((await run(cmd("nope" as ActionId))).error).toBe("unknown_action");
    expect((await run(cmd("lights.mode"))).error).toBe("invalid_value");
    expect((await run(cmd("lights.mode", { value: "high" }))).error).toBe("invalid_value");
    expect((await run(cmd("retarder.level", { value: "9" }))).error).toBe("invalid_value");
    expect((await run(cmd("horn"))).error).toBe("invalid_value"); // hold bez op
  });

  it("game_not_connected / input_disabled / game_paused", async () => {
    sim.store.setStatus({ connected: false });
    expect((await run(cmd("horn", { op: "down" }))).error).toBe("game_not_connected");
    sim.store.setStatus({ connected: true, inputEnabled: false });
    expect((await run(cmd("lights.hazard"))).error).toBe("input_disabled");
    sim.store.setStatus({ inputEnabled: true, paused: true });
    expect((await run(cmd("lights.hazard"))).error).toBe("game_paused");
    expect((await run(cmd("ui.pause"))).ok).toBe(true);
  });

  it("not_supported: wejście nieobecne w hello.inputs, device keyboard", async () => {
    router.setInputs({ semantical: ["light"], generic: [] });
    expect((await run(cmd("lights.hazard"))).error).toBe("not_supported");
    expect((await run(cmd("lights.cycle"))).ok).toBe(true);
    // set wymaga wszystkich wejść
    expect((await run(cmd("retarder.level", { value: "1" }))).error).toBe("not_supported");
  });

  it("in.ack ok:false z pluginu → not_supported", async () => {
    sim.rejectAll = true;
    expect((await run(cmd("lights.cycle"))).error).toBe("not_supported");
  });

  it("press: ack po in.ack, tookMs > 0", async () => {
    const a = await run(cmd("lights.hazard"));
    expect(a.ok).toBe(true);
    expect(a.tookMs).toBeGreaterThanOrEqual(10);
    expect(sim.presses("flasher4way")).toHaveLength(1);
  });

  it("press bez in.ack → timeout po 2 s", async () => {
    sim.silent = true;
    const a = await run(cmd("lights.hazard"));
    expect(a.ok).toBe(false);
    expect(a.tookMs).toBeGreaterThanOrEqual(2000);
  });
});

describe("set: lights.mode", () => {
  it("off → low = 2 naciśnięcia, ack z osiągniętym stanem", async () => {
    const a = await run(cmd("lights.mode", { value: "low" }));
    expect(a).toMatchObject({ ok: true, state: "low" });
    expect(sim.presses("light")).toHaveLength(2);
    expect(a.tookMs).toBeLessThan(SET_TIMEOUT_MS);
  });

  it("low → parking = 2 naciśnięcia (cykl low → off → parking)", async () => {
    await run(cmd("lights.mode", { value: "low" }));
    sim.sent.length = 0;
    const a = await run(cmd("lights.mode", { value: "parking" }));
    expect(a).toMatchObject({ ok: true, state: "parking" });
    expect(sim.presses("light")).toHaveLength(2);
  });

  it("stan już zgodny → 0 naciśnięć, natychmiastowy ack", async () => {
    const a = await run(cmd("lights.mode", { value: "off" }));
    expect(a).toMatchObject({ ok: true, state: "off" });
    expect(sim.presses()).toHaveLength(0);
  });

  it("zgubione naciśnięcie → pętla powtarza i dociera do celu", async () => {
    sim.dropPresses = 1;
    const a = await run(cmd("lights.mode", { value: "parking" }));
    expect(a).toMatchObject({ ok: true, state: "parking" });
    expect(sim.presses("light")).toHaveLength(2);
  });

  it("stan nie reaguje → timeout, nie więcej niż teoretyczne + 3 naciśnięcia", async () => {
    sim.dropPresses = 99;
    const a = await run(cmd("lights.mode", { value: "low" }));
    expect(a).toMatchObject({ ok: false, error: "timeout" });
    expect(sim.presses("light").length).toBeLessThanOrEqual(2 + 3);
    expect(a.tookMs).toBeLessThanOrEqual(SET_TIMEOUT_MS + 50);
  });

  it("dwie równoległe komendy set na tej samej akcji są szeregowane", async () => {
    const p1 = router.handle(cmd("lights.mode", { value: "low" }), "A");
    const p2 = router.handle(cmd("lights.mode", { value: "off" }), "B");
    await vi.advanceTimersByTimeAsync(3000);
    const [a1, a2] = await Promise.all([p1, p2]);
    expect(a1).toMatchObject({ ok: true, state: "low" });
    expect(a2).toMatchObject({ ok: true, state: "off" });
    expect(sim.lightsMode).toBe(0);
  });
});

describe("set: retarder.level", () => {
  it("0 → 3 = 3× retarderup", async () => {
    const a = await run(cmd("retarder.level", { value: "3" }));
    expect(a).toMatchObject({ ok: true, state: "3" });
    expect(sim.presses("retarderup")).toHaveLength(3);
    expect(sim.presses("retarderdown")).toHaveLength(0);
  });

  it("4 → 1 = 3× retarderdown", async () => {
    sim.store.setFast("retarder", 4);
    const a = await run(cmd("retarder.level", { value: "1" }));
    expect(a).toMatchObject({ ok: true, state: "1" });
    expect(sim.presses("retarderdown")).toHaveLength(3);
  });

  it("stopień powyżej retarderSteps z configu → invalid_value", async () => {
    sim.store.setConfig("truck", {
      brand: "x", brandId: "x", name: "x", id: "x", fuelCapacity: 1, fuelWarningFactor: 0.1, adblueCapacity: 1,
      airPressureWarning: 1, airPressureEmergency: 1, rpmLimit: 1, forwardGears: 1, reverseGears: 1,
      retarderSteps: 3, licensePlate: null,
    });
    expect((await run(cmd("retarder.level", { value: "4" }))).error).toBe("invalid_value");
    expect((await run(cmd("retarder.level", { value: "3" }))).ok).toBe(true);
  });
});

describe("set: wipers.level", () => {
  it("wysyła bezpośrednio wipersN bez weryfikacji, ack po in.ack", async () => {
    const a = await run(cmd("wipers.level", { value: "3" }));
    expect(a).toMatchObject({ ok: true, state: "3" });
    expect(sim.presses()).toHaveLength(1);
    expect(sim.presses()[0]!.input).toBe("wipers3");
  });
});

describe("hold: keep-watchdog, HOLD_MAX_MS, rozłączenie", () => {
  it("down → in down; up → in up", async () => {
    expect((await run(cmd("horn", { op: "down" }))).ok).toBe(true);
    expect(sim.ops("down").map((m) => m.input)).toEqual(["horn"]);
    expect((await run(cmd("horn", { op: "up" }))).ok).toBe(true);
    expect(sim.ops("up").map((m) => m.input)).toEqual(["horn"]);
    expect(router.holdCount("A")).toBe(0);
  });

  it("brak keep przez HOLD_WATCHDOG_MS → bridge zwalnia sam", async () => {
    await run(cmd("horn", { op: "down" }));
    await vi.advanceTimersByTimeAsync(HOLD_WATCHDOG_MS - 100);
    expect(sim.ops("up")).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(200);
    expect(sim.ops("up")).toHaveLength(1);
    expect(router.holdCount("A")).toBe(0);
  });

  it("keep przedłuża, ale twardy limit HOLD_MAX_MS zwalnia i tak", async () => {
    await run(cmd("horn", { op: "down" }));
    for (let t = 0; t < HOLD_MAX_MS - 2000; t += 1000) {
      await vi.advanceTimersByTimeAsync(1000);
      expect((await run(cmd("horn", { op: "keep" }))).ok).toBe(true);
    }
    expect(sim.ops("up")).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(2500);
    expect(sim.ops("up")).toHaveLength(1);
    // dalszy keep dostaje błąd: UI ma cofnąć stan
    const k = await run(cmd("horn", { op: "keep" }));
    expect(k).toMatchObject({ ok: false, error: "invalid_value" });
  });

  it("rozłączenie klienta zwalnia jego wejścia", async () => {
    await run(cmd("horn", { op: "down" }));
    await run(cmd("airHorn", { op: "down" }));
    router.releaseClient("A");
    expect(sim.ops("up").map((m) => m.input).sort()).toEqual(["airhorn", "horn"]);
  });

  it("dwóch klientów trzyma ten sam input: up dopiero po ostatnim", async () => {
    await run(cmd("horn", { op: "down" }), "A");
    await run(cmd("horn", { op: "down" }), "B");
    expect(sim.ops("down")).toHaveLength(1);
    await run(cmd("horn", { op: "up" }), "A");
    expect(sim.ops("up")).toHaveLength(0);
    router.releaseClient("B");
    expect(sim.ops("up")).toHaveLength(1);
  });

  it("up bez down jest idempotentne, keep bez down → invalid_value", async () => {
    expect((await run(cmd("horn", { op: "up" }))).ok).toBe(true);
    expect(sim.ops("up")).toHaveLength(0);
    expect((await run(cmd("horn", { op: "keep" }))).error).toBe("invalid_value");
  });

  it("utrata źródła czyści holdy bez wysyłania up", async () => {
    await run(cmd("horn", { op: "down" }));
    sim.sent.length = 0;
    router.onSourceDisconnected();
    expect(sim.sent).toHaveLength(0);
    expect(router.holdCount("A")).toBe(0);
    await vi.advanceTimersByTimeAsync(HOLD_MAX_MS + 100);
    expect(sim.sent).toHaveLength(0);
  });

  it("releaseAll wysyła releaseAll do pluginu", () => {
    router.releaseAll();
    expect(sim.sent.at(-1)).toEqual({ t: "releaseAll" });
  });
});

describe("RateLimiter", () => {
  it("20/s ok, 21. limited, po sekundzie znów ok, flood powyżej 5×", () => {
    let now = 0;
    const r = new RateLimiter(20, 5, () => now);
    for (let i = 0; i < 20; i++) expect(r.hit("a")).toBe("ok");
    expect(r.hit("a")).toBe("limited");
    expect(r.hit("b")).toBe("ok"); // osobno per klient
    now += 1000;
    expect(r.hit("a")).toBe("ok");
    let last = "ok";
    for (let i = 0; i < 120; i++) last = r.hit("a");
    expect(last).toBe("flood");
  });
});
