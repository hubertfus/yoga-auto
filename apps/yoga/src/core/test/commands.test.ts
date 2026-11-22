import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AckMsg, ClientMsg, ServerMsg } from "@yoga-auto/protocol";
import { CommandBus, KEEP_INTERVAL_MS, OPTIMISTIC_GRACE_MS, type CommandFailure } from "../commands.ts";

function makeBus(connected = true) {
  const sent: ClientMsg[] = [];
  let listener: (m: ServerMsg) => void = () => {};
  const bus = new CommandBus(
    {
      send: (m) => {
        if (connected) sent.push(m);
        return connected;
      },
      onMessage: (l) => {
        listener = l;
        return () => {};
      },
    },
    2000,
  );
  const ack = (id: string, ok = true, error?: AckMsg["error"]): void =>
    listener({ t: "ack", id, ok, ...(error ? { error } : {}), tookMs: 5 });
  const failures: CommandFailure[] = [];
  bus.onFailure((f) => failures.push(f));
  return { bus, sent, ack, failures };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("CommandBus", () => {
  it("press: wysyła cmd, pending do ack, resolve z ack", async () => {
    const { bus, sent, ack } = makeBus();
    const p = bus.sendCmd("horn" as never);
    expect(sent[0]).toMatchObject({ t: "cmd", action: "horn" });
    const id = (sent[0] as { id: string }).id;
    expect(bus.isPending("horn" as never)).toBe(true);
    ack(id);
    await expect(p).resolves.toMatchObject({ ok: true });
    expect(bus.isPending("horn" as never)).toBe(false);
  });

  it("brak ack w 2 s → timeout, pending zdjęty, błąd zgłoszony", async () => {
    const { bus, failures } = makeBus();
    const p = bus.sendCmd("lights.high" as never);
    vi.advanceTimersByTime(2000);
    await expect(p).resolves.toMatchObject({ ok: false, error: "timeout" });
    expect(bus.isPending("lights.high" as never)).toBe(false);
    expect(failures).toHaveLength(1);
  });

  it("brak połączenia → natychmiastowe game_not_connected, bez pending", async () => {
    const { bus, failures } = makeBus(false);
    await expect(bus.sendCmd("lights.high" as never)).resolves.toMatchObject({
      ok: false,
      error: "game_not_connected",
    });
    expect(bus.isPending("lights.high" as never)).toBe(false);
    expect(failures[0]?.ack.error).toBe("game_not_connected");
  });

  it("optymizm: wartość od razu, po ok:true zostaje na czas łaski, po ok:false rollback", async () => {
    const { bus, sent, ack, failures } = makeBus();
    const p1 = bus.sendCmd("lights.mode" as never, "low", { optimistic: "low" });
    expect(bus.getOptimistic("lights.mode" as never)?.value).toBe("low");
    ack((sent[0] as { id: string }).id, true);
    await p1;
    expect(bus.getOptimistic("lights.mode" as never)?.value).toBe("low"); // czekamy na telemetrię
    vi.advanceTimersByTime(OPTIMISTIC_GRACE_MS);
    expect(bus.getOptimistic("lights.mode" as never)).toBeUndefined();

    const p2 = bus.sendCmd("lights.mode" as never, "parking", { optimistic: "parking" });
    expect(bus.getOptimistic("lights.mode" as never)?.value).toBe("parking");
    ack((sent[1] as { id: string }).id, false, "game_paused");
    await p2;
    expect(bus.getOptimistic("lights.mode" as never)).toBeUndefined(); // rollback
    expect(failures[0]?.ack.error).toBe("game_paused");
  });

  it("optymizm: timeout też cofa", async () => {
    const { bus } = makeBus();
    const p = bus.sendCmd("lights.mode" as never, "low", { optimistic: "low" });
    vi.advanceTimersByTime(2000);
    await p;
    expect(bus.getOptimistic("lights.mode" as never)).toBeUndefined();
  });

  it("starszy ack nie kasuje nowszej wartości optymistycznej", async () => {
    const { bus, sent, ack } = makeBus();
    const p1 = bus.sendCmd("lights.mode" as never, "low", { optimistic: "low" });
    bus.sendCmd("lights.mode" as never, "off", { optimistic: "off" });
    ack((sent[0] as { id: string }).id, false, "timeout");
    await p1;
    expect(bus.getOptimistic("lights.mode" as never)?.value).toBe("off");
  });

  it("hold: down → keep co 1 s → up; keep zatrzymany po holdEnd", () => {
    const { bus, sent } = makeBus();
    void bus.holdStart("horn" as never);
    expect(sent.at(-1)).toMatchObject({ op: "down" });
    vi.advanceTimersByTime(KEEP_INTERVAL_MS * 3);
    expect(sent.filter((m) => m.t === "cmd" && m.op === "keep")).toHaveLength(3);
    void bus.holdEnd("horn" as never);
    expect(sent.at(-1)).toMatchObject({ op: "up" });
    const n = sent.length;
    vi.advanceTimersByTime(KEEP_INTERVAL_MS * 3);
    expect(sent).toHaveLength(n);
  });

  it("releaseAllHolds puszcza wszystkie trzymane akcje", () => {
    const { bus, sent } = makeBus();
    void bus.holdStart("horn" as never);
    void bus.holdStart("beacon" as never);
    bus.releaseAllHolds();
    expect(sent.filter((m) => m.t === "cmd" && m.op === "up")).toHaveLength(2);
  });

  it("sendMedia i tripReset używają własnych typów wiadomości", () => {
    const { bus, sent } = makeBus();
    void bus.sendMedia("next");
    void bus.tripReset();
    expect(sent[0]).toMatchObject({ t: "media", action: "next" });
    expect(sent[1]).toMatchObject({ t: "trip.reset" });
    expect(bus.isPending("media.next")).toBe(true);
    expect(bus.isPending("trip.reset")).toBe(true);
  });
});
