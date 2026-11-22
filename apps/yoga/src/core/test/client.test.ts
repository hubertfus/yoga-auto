import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLIENT_STALE_MS, RECONNECT_MAX_MS, RECONNECT_MIN_MS, WS_SUBPROTOCOL, WsCloseCode } from "@yoga-auto/protocol";
import { ProtocolClient } from "../client.ts";
import { RESYNC_MIN_INTERVAL_MS, TelemetryStore } from "../store.ts";
import { FakeWebSocket, hello, snapshot } from "./utils.ts";

const FAKE = ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date", "performance"] as const;

function setup(random = () => 0.5 /* jitter = 1.0 */) {
  const store = new TelemetryStore();
  const client = new ProtocolClient({
    WebSocket: FakeWebSocket as never,
    store,
    random,
    listenWindow: false,
  });
  client.start("ws://test/ws");
  return { store, client };
}

function connect() {
  const ws = FakeWebSocket.last();
  ws.serverOpen();
  ws.serverSend(hello());
  ws.serverSend(snapshot(10));
  return ws;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: [...FAKE], now: 1_000_000 });
  vi.advanceTimersByTime(5); // performance.now() > 0 (lastMsgAt = 0 znaczy „brak”)
  FakeWebSocket.instances = [];
});
afterEach(() => {
  vi.useRealTimers();
});

describe("ProtocolClient — połączenie", () => {
  it("łączy się z subprotokołem i przechodzi w `open` po hello", () => {
    const { store } = setup();
    const ws = FakeWebSocket.last();
    expect(ws.protocols[0]).toBe(WS_SUBPROTOCOL);
    expect(store.conn.state).toBe("connecting");
    ws.serverOpen();
    expect(store.conn.state).toBe("connecting");
    ws.serverSend(hello());
    expect(store.conn.state).toBe("open");
    expect(store.conn.session).toBe("s1");
    expect(store.conn.attempt).toBe(0);
  });

  it("reconnect z backoffem 250 → 500 → 1000 → 2000 → 4000 → 4000 ms", () => {
    const { store } = setup();
    const delays = [RECONNECT_MIN_MS, 500, 1000, 2000, RECONNECT_MAX_MS, RECONNECT_MAX_MS];
    for (const d of delays) {
      const before = FakeWebSocket.instances.length;
      FakeWebSocket.last().serverClose(1006);
      expect(store.conn.state).toBe("closed");
      vi.advanceTimersByTime(d - 1);
      expect(FakeWebSocket.instances.length).toBe(before);
      vi.advanceTimersByTime(1);
      expect(FakeWebSocket.instances.length).toBe(before + 1);
    }
  });

  it("jitter ±20%", () => {
    setup(() => 0); // jitter 0.8
    FakeWebSocket.last().serverClose(1006);
    vi.advanceTimersByTime(RECONNECT_MIN_MS * 0.8);
    expect(FakeWebSocket.instances.length).toBe(2);
  });

  it("udane hello resetuje backoff", () => {
    setup();
    for (let i = 0; i < 4; i++) {
      FakeWebSocket.last().serverClose(1006);
      vi.advanceTimersByTime(RECONNECT_MAX_MS);
    }
    connect();
    FakeWebSocket.last().serverClose(1006);
    const n = FakeWebSocket.instances.length;
    vi.advanceTimersByTime(RECONNECT_MIN_MS);
    expect(FakeWebSocket.instances.length).toBe(n + 1);
  });

  it("4003 → `unauthorized`, bez automatycznych prób; reconnect() łączy od razu", () => {
    const { store, client } = setup();
    FakeWebSocket.last().serverClose(WsCloseCode.Unauthorized);
    expect(store.conn.state).toBe("unauthorized");
    vi.advanceTimersByTime(60_000);
    expect(FakeWebSocket.instances.length).toBe(1);
    client.reconnect();
    expect(FakeWebSocket.instances.length).toBe(2);
    expect(store.conn.state).toBe("connecting");
  });

  it("inna wersja major w hello → `mismatch` i zamknięcie", () => {
    const { store } = setup();
    const ws = FakeWebSocket.last();
    ws.serverOpen();
    ws.serverSend(hello("s1", 99));
    expect(store.conn.state).toBe("mismatch");
    expect(ws.closed).toBe(true);
  });

  it("watchdog łączenia: brak otwarcia w CLIENT_STALE_MS → nowa próba", () => {
    const { store } = setup();
    vi.advanceTimersByTime(CLIENT_STALE_MS);
    expect(FakeWebSocket.instances[0]!.closed).toBe(true);
    expect(store.conn.state).toBe("closed");
    vi.advanceTimersByTime(RECONNECT_MIN_MS);
    expect(FakeWebSocket.instances.length).toBe(2);
  });
});

describe("ProtocolClient — ping i stale", () => {
  it("ping co 1 s, RTT z pong", () => {
    const { store } = setup();
    const ws = connect();
    vi.advanceTimersByTime(1000);
    const pings = ws.sentOfType("ping") as { t0: number }[];
    expect(pings).toHaveLength(1);
    vi.advanceTimersByTime(12);
    ws.serverSend({ t: "pong", t0: pings[0]!.t0, ts: 0 });
    expect(store.conn.rttMs).toBe(12);
  });

  it("cisza > CLIENT_STALE_MS → zamknięcie i reconnect", () => {
    const { store } = setup();
    const ws = connect();
    vi.advanceTimersByTime(CLIENT_STALE_MS + 1000);
    expect(ws.closed).toBe(true);
    expect(store.conn.state).toBe("closed");
    vi.advanceTimersByTime(RECONNECT_MIN_MS);
    expect(FakeWebSocket.instances.length).toBe(2);
  });

  it("regularne wiadomości podtrzymują połączenie", () => {
    const { store } = setup();
    const ws = connect();
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(1000);
      ws.serverSend({ t: "pong", t0: performance.now(), ts: 0 });
    }
    expect(ws.closed).toBe(false);
    expect(store.conn.state).toBe("open");
  });
});

describe("ProtocolClient — seq, resync, sesja", () => {
  it("dziura w seq → jeden resync; snapshot kończy resync", () => {
    const { store } = setup();
    const ws = connect();
    ws.serverSend({ t: "slow", seq: 11, ts: 0, d: {} });
    expect(ws.sentOfType("resync")).toHaveLength(0);
    ws.serverSend({ t: "slow", seq: 14, ts: 0, d: {} }); // brakuje 12, 13
    ws.serverSend({ t: "fast", seq: 16, ts: 0, frame: 1, d: { speed: 5 } }); // kolejna dziura, ale resync w toku
    expect(ws.sentOfType("resync")).toHaveLength(1);
    // delty stosowane dalej do czasu snapshotu
    expect(store.state.fast.speed).toBe(5);
    ws.serverSend(snapshot(20));
    vi.advanceTimersByTime(RESYNC_MIN_INTERVAL_MS);
    ws.serverSend({ t: "slow", seq: 22, ts: 0, d: {} });
    expect(ws.sentOfType("resync")).toHaveLength(2);
  });

  it("resync co najwyżej raz na RESYNC_MIN_INTERVAL_MS (bridge gubiący seq nie zalewa snapshotami)", () => {
    setup();
    const ws = connect();
    ws.serverSend({ t: "slow", seq: 13, ts: 0, d: {} });
    ws.serverSend(snapshot(13));
    ws.serverSend({ t: "slow", seq: 16, ts: 0, d: {} }); // kolejna dziura zaraz po snapshocie
    expect(ws.sentOfType("resync")).toHaveLength(1);
    vi.advanceTimersByTime(RESYNC_MIN_INTERVAL_MS);
    ws.serverSend({ t: "slow", seq: 19, ts: 0, d: {} });
    expect(ws.sentOfType("resync")).toHaveLength(2);
  });

  it("zmiana session po reconnect czyści stan", () => {
    const { store } = setup();
    const ws = connect();
    ws.serverSend({ t: "fast", seq: 11, ts: 0, frame: 1, d: { speed: 20 } });
    expect(store.state.fast.speed).toBe(20);
    ws.serverClose(1006);
    vi.advanceTimersByTime(RECONNECT_MIN_MS);
    const ws2 = FakeWebSocket.last();
    ws2.serverOpen();
    ws2.serverSend(hello("s1"));
    expect(store.state.fast.speed).toBe(20); // ta sama sesja → stan zostaje
    ws2.serverClose(1006);
    vi.advanceTimersByTime(RECONNECT_MIN_MS);
    const ws3 = FakeWebSocket.last();
    ws3.serverOpen();
    ws3.serverSend(hello("s2"));
    expect(store.state.fast.speed).toBe(0);
  });

  it("nowy bridge zaczyna seq od 1 — bez fałszywego resync", () => {
    setup();
    const ws = connect(); // snapshot seq 10
    ws.serverClose(1006);
    vi.advanceTimersByTime(RECONNECT_MIN_MS);
    const ws2 = FakeWebSocket.last();
    ws2.serverOpen();
    ws2.serverSend(hello("s2"));
    ws2.serverSend(snapshot(1));
    ws2.serverSend({ t: "slow", seq: 2, ts: 0, d: {} });
    expect(ws2.sentOfType("resync")).toHaveLength(0);
  });

  it("subskrypcja wysyłana po każdym hello", () => {
    const { client } = setup();
    client.subscribe({ fastHz: 60 });
    const ws = connect();
    expect(ws.sentOfType("subscribe")).toEqual([{ t: "subscribe", fastHz: 60 }]);
    client.subscribe({ placement: true });
    expect(ws.sentOfType("subscribe").at(-1)).toEqual({ t: "subscribe", fastHz: 60, placement: true });
  });

  it("ignoruje nieznane typy i śmieci", () => {
    const { store } = setup();
    const ws = connect();
    ws.onmessage?.({ data: "nie-json" });
    ws.serverSend({ t: "future-thing", x: 1 });
    expect(store.conn.state).toBe("open");
  });
});
