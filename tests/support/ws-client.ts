/** Klient WS do testów przekrojowych: zbiera wszystkie wiadomości i pozwala czekać na warunki. */
import { WebSocket } from "ws";
import { WS_SUBPROTOCOL, type ClientMsg, type ServerMsg } from "@yoga-auto/protocol";

export interface Rx {
  msg: ServerMsg;
  /** performance.now() przy odbiorze */
  at: number;
  /** Date.now() przy odbiorze */
  wall: number;
  raw: string;
}

export class TestWsClient {
  readonly rx: Rx[] = [];
  readonly invalid: { raw: string; error: string }[] = [];
  closeCode: number | null = null;
  private ws!: WebSocket;
  private waiters = new Set<() => void>();

  readonly url: string;
  readonly protocols: string[];

  constructor(url: string, protocols: string[] = [WS_SUBPROTOCOL]) {
    this.url = url;
    this.protocols = protocols;
  }

  static async connect(port: number, protocols?: string[], host = "127.0.0.1"): Promise<TestWsClient> {
    const c = new TestWsClient(`ws://${host}:${port}/ws`, protocols);
    await c.open();
    return c;
  }

  open(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url, this.protocols);
      this.ws.on("message", (d) => {
        const raw = String(d);
        try {
          this.rx.push({ msg: JSON.parse(raw) as ServerMsg, at: performance.now(), wall: Date.now(), raw });
        } catch (e) {
          this.invalid.push({ raw, error: String(e) });
        }
        this.waiters.forEach((w) => w());
      });
      this.ws.on("close", (code) => {
        this.closeCode = code;
        this.waiters.forEach((w) => w());
      });
      this.ws.once("open", () => resolve());
      this.ws.once("error", reject);
      this.ws.once("close", (code) => reject(new Error(`closed before open: ${code}`)));
    });
  }

  send(msg: ClientMsg | Record<string, unknown>): void {
    this.ws.send(JSON.stringify(msg));
  }

  sendRaw(s: string): void {
    this.ws.send(s);
  }

  get isOpen(): boolean {
    return this.ws.readyState === WebSocket.OPEN;
  }

  of<T extends ServerMsg["t"]>(t: T): Extract<ServerMsg, { t: T }>[] {
    return this.rx.filter((r) => r.msg.t === t).map((r) => r.msg as Extract<ServerMsg, { t: T }>);
  }

  waitFor(pred: (rx: Rx[]) => boolean, timeoutMs = 3000): Promise<void> {
    return new Promise((resolve, reject) => {
      if (pred(this.rx)) return resolve();
      const timer = setTimeout(() => {
        this.waiters.delete(check);
        reject(new Error(`waitFor timeout after ${timeoutMs} ms (rx=${this.rx.length})`));
      }, timeoutMs);
      const check = () => {
        if (!pred(this.rx)) return;
        clearTimeout(timer);
        this.waiters.delete(check);
        resolve();
      };
      this.waiters.add(check);
    });
  }

  /** Wyślij `cmd` i poczekaj na `ack` o tym id. */
  async cmd(
    id: string,
    action: string,
    extra: { op?: string; value?: string } = {},
    timeoutMs = 3000,
  ): Promise<Extract<ServerMsg, { t: "ack" }>> {
    this.send({ t: "cmd", id, action, ...extra });
    await this.waitFor((rx) => rx.some((r) => r.msg.t === "ack" && r.msg.id === id), timeoutMs);
    return this.of("ack").find((a) => a.id === id)!;
  }

  close(): void {
    this.ws.close();
  }

  terminate(): void {
    this.ws.terminate();
  }
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
