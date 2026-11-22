// @vitest-environment jsdom
/**
 * Panel pojazdu z prawdziwym bridge'em na MockSource (WS na porcie efemerycznym):
 * każda akcja z ACTIONS wysyła poprawny `cmd`, stan przycisku zgadza się z telemetrią po ack,
 * rollback działa przy `ok:false`.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// jsdom miesza Event z undici (globalny WebSocket Node) — dla testu używamy `ws`. Musi zdążyć przed importem client.ts.
await vi.hoisted(async () => {
  const { WebSocket } = await import("ws");
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = WebSocket;
});
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ACTIONS, type ActionId, type ClientMsg, type ServerMsg } from "@yoga-auto/protocol";
import { createMockSource } from "@yoga-auto/mock";
import { startBridge } from "../../../../../bridge/src/server.ts";
import { client } from "../../core/client.ts";
import { commands } from "../../core/commands.ts";
import { store } from "../../core/store.ts";
import { ActionButton, resetUnsupported } from "../_shared/actions.tsx";
import { LightsModeControl } from "../lights/index.tsx";
import { VehicleScreen } from "../vehicle/index.tsx";

let bridge: Awaited<ReturnType<typeof startBridge>>;
const sent: ClientMsg[] = [];
const acks: Extract<ServerMsg, { t: "ack" }>[] = [];
const realSend = client.send.bind(client);

beforeAll(async () => {
  bridge = await startBridge({
    source: createMockSource({ scenario: "highway" }),
    port: 0,
    host: "127.0.0.1",
    auth: false,
    log: () => {},
  });
  vi.spyOn(client, "send").mockImplementation((m) => {
    sent.push(m);
    return realSend(m);
  });
  client.onMessage((m) => {
    if (m.t === "ack") acks.push(m);
  });
  client.start(`ws://127.0.0.1:${bridge.port}/ws`);
  await vi.waitFor(() => expect(store.state.status.connected && store.state.status.inputEnabled).toBe(true), { timeout: 10_000 });
}, 20_000);

afterAll(async () => {
  client.stop();
  await bridge.close();
});

afterEach(() => cleanup());

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ackFor = (id: string) => acks.find((a) => a.id === id);
const cmds = (): Extract<ClientMsg, { t: "cmd" }>[] => sent.filter((m): m is Extract<ClientMsg, { t: "cmd" }> => m.t === "cmd");

describe("panel pojazdu ↔ mock bridge", () => {
  const ids = (Object.keys(ACTIONS) as ActionId[]).filter((id) => ACTIONS[id].kind !== "set");

  it.each(ids)("akcja %s wysyła cmd z poprawnym id akcji", async (id) => {
    sent.length = 0;
    render(<ActionButton id={id} />);
    const button = screen.getByRole("button");
    if (ACTIONS[id].kind === "hold") {
      fireEvent.pointerDown(button, { pointerId: 1, button: 0, pointerType: "mouse" });
      fireEvent.pointerUp(button, { pointerId: 1, pointerType: "mouse" });
      const c = cmds().filter((m) => m.action === id);
      expect(c.map((m) => m.op)).toEqual(["down", "up"]);
    } else {
      fireEvent.click(button);
      const c = cmds().filter((m) => m.action === id);
      expect(c).toHaveLength(1);
      expect(c[0]).toMatchObject({ t: "cmd", action: id });
      expect(c[0]!.op).toBeUndefined();
      await vi.waitFor(() => expect(ackFor(c[0]!.id)).toBeDefined(), { timeout: 3000 });
      expect(ackFor(c[0]!.id)!.ok).toBe(true);
    }
    if (id === "ui.pause") {
      // pauza w mocku blokuje pozostałe komendy (game_paused) — poczekaj aż dojdzie status, potem wznów
      await vi.waitFor(() => expect(store.state.status.paused).toBe(true), { timeout: 3000 });
      cleanup();
      render(<ActionButton id="ui.pause" />);
      fireEvent.click(screen.getByRole("button"));
      await vi.waitFor(() => expect(store.state.status.paused).toBe(false), { timeout: 3000 });
    }
    await wait(60); // limit 20 komend/s po stronie bridge'a
  });

  it("lights.high: przycisk świeci zgodnie z telemetrią po ack i gaśnie po ponownym naciśnięciu", async () => {
    // drogowe działają tylko przy włączonych mijania
    render(<LightsModeControl />);
    fireEvent.click(screen.getByRole("radio", { name: "Mijania" }));
    await vi.waitFor(() => expect(store.state.fast.lights.low).toBe(true), { timeout: 3000 });
    cleanup();
    await wait(500);
    render(<ActionButton id="lights.high" />);
    const button = screen.getByRole("button");
    const was = store.state.fast.lights.high;
    expect(button.getAttribute("aria-pressed")).toBe(String(was));
    fireEvent.click(button);
    await vi.waitFor(() => expect(store.state.fast.lights.high).toBe(!was), { timeout: 3000 });
    await vi.waitFor(() => expect(button.getAttribute("aria-pressed")).toBe(String(!was)), { timeout: 3000 });
    await wait(500); // minięcie okresu karencji optymizmu + limit komend
    fireEvent.click(button);
    await vi.waitFor(() => expect(store.state.fast.lights.high).toBe(was), { timeout: 3000 });
    await vi.waitFor(() => expect(button.getAttribute("aria-pressed")).toBe(String(was)), { timeout: 3000 });
  });

  it("lights.mode (set): wysyła value i osiąga stan docelowy", async () => {
    sent.length = 0;
    render(<LightsModeControl />);
    fireEvent.click(screen.getByRole("radio", { name: "Mijania" }));
    const c = cmds().find((m) => m.action === "lights.mode")!;
    expect(c).toMatchObject({ value: "low" });
    await vi.waitFor(() => expect(store.state.fast.lights.low).toBe(true), { timeout: 3000 });
    expect(screen.getByRole("radio", { name: "Mijania" }).getAttribute("aria-checked")).toBe("true");
  });

  it("rollback: ok:false cofa optymistyczny stan przycisku", async () => {
    sent.length = 0;
    const spy = vi.mocked(client.send);
    spy.mockImplementationOnce((m) => {
      sent.push(m); // nie wysyłamy do bridge'a — ack wstrzykniemy sami
      return true;
    });
    render(<ActionButton id="lights.beacon" />);
    const button = screen.getByRole("button");
    const before = button.getAttribute("aria-pressed");
    fireEvent.click(button);
    await vi.waitFor(() => expect(button.getAttribute("aria-pressed")).not.toBe(before)); // optymizm
    const id = cmds()[0]!.id;
    (commands as unknown as { onAck(a: unknown): void }).onAck({ t: "ack", id, ok: false, error: "input_disabled", tookMs: 3 });
    await vi.waitFor(() => expect(button.getAttribute("aria-pressed")).toBe(before));
  });

  it("not_supported wyszarza przycisk z tooltipem", async () => {
    resetUnsupported();
    sent.length = 0;
    const spy = vi.mocked(client.send);
    spy.mockImplementationOnce((m) => {
      sent.push(m);
      return true;
    });
    render(<ActionButton id="ui.hud" />);
    const button = screen.getByRole("button") as HTMLButtonElement;
    fireEvent.click(button);
    const id = cmds()[0]!.id;
    (commands as unknown as { onAck(a: unknown): void }).onAck({ t: "ack", id, ok: false, error: "not_supported", tookMs: 3 });
    await vi.waitFor(() => expect(button.disabled).toBe(true));
    expect(button.title).toMatch(/Niedostępne/);
    resetUnsupported();
  });

  it("ekran Pojazd renderuje przycisk dla każdej akcji z katalogu", () => {
    render(<VehicleScreen />);
    for (const id of Object.keys(ACTIONS) as ActionId[]) {
      expect(document.querySelector(`[data-action="${id}"]`), id).not.toBeNull();
    }
  });
});
