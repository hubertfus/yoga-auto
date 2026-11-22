/** Narzędzia testowe core (tylko dla *.test.ts). */
import { emptyFullState, PROTOCOL_VERSION, type HelloMsg, type ServerMsg } from "@yoga-auto/protocol";

export class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static last(): FakeWebSocket {
    const ws = FakeWebSocket.instances.at(-1);
    if (!ws) throw new Error("brak WebSocket");
    return ws;
  }

  readyState = 0;
  sent: unknown[] = [];
  onopen: ((e: unknown) => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  closed = false;
  readonly url: string;
  readonly protocols: string[];

  constructor(url: string, protocols?: string | string[]) {
    this.url = url;
    this.protocols = typeof protocols === "string" ? [protocols] : (protocols ?? []);
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.readyState = 3;
    this.onclose?.({ code: 1005 });
  }

  // ─── sterowanie z testu ───
  serverOpen(): void {
    this.readyState = 1;
    this.onopen?.({});
  }

  serverSend(msg: ServerMsg | Record<string, unknown>): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }

  serverClose(code = 1006): void {
    this.closed = true;
    this.readyState = 3;
    this.onclose?.({ code });
  }

  sentOfType(t: string): unknown[] {
    return this.sent.filter((m) => (m as { t: string }).t === t);
  }
}

export function hello(session = "s1", major: number = PROTOCOL_VERSION): HelloMsg {
  return {
    t: "hello",
    protocol: { major, minor: 0 },
    server: { name: "bridge", version: "0.0.0", hostname: "pc" },
    session,
    capabilities: { input: true, media: true, map: false, record: false },
    rates: { fastHz: 30, slowHz: 2 },
  };
}

export function snapshot(seq: number): ServerMsg {
  return { t: "snapshot", seq, ts: 0, state: emptyFullState() };
}
