import { WebSocket } from "ws";
import { WS_SUBPROTOCOL, type AckMsg, type ClientMsg, type ServerMsg } from "@yoga-auto/protocol";

export class TestClient {
  readonly msgs: ServerMsg[] = [];
  closeCode: number | null = null;
  readonly ws: WebSocket;
  private waiters: { pred: (m: ServerMsg) => boolean; resolve: (m: ServerMsg) => void }[] = [];

  constructor(port: number, protocols: string[] = [WS_SUBPROTOCOL], host = "127.0.0.1") {
    this.ws = new WebSocket(`ws://${host}:${port}/ws`, protocols);
    this.ws.on("message", (d) => {
      const m = JSON.parse(String(d)) as ServerMsg;
      this.msgs.push(m);
      this.waiters = this.waiters.filter((w) => {
        if (!w.pred(m)) return true;
        w.resolve(m);
        return false;
      });
    });
    this.ws.on("close", (code) => (this.closeCode = code));
    this.ws.on("error", () => {});
  }

  opened(): Promise<void> {
    return new Promise((res, rej) => {
      this.ws.once("open", () => res());
      this.ws.once("close", () => rej(new Error(`closed ${this.closeCode}`)));
    });
  }

  closed(): Promise<number> {
    if (this.closeCode !== null) return Promise.resolve(this.closeCode);
    return new Promise((res) => this.ws.once("close", (c) => res(c)));
  }

  send(msg: ClientMsg): void {
    this.ws.send(JSON.stringify(msg));
  }

  next<T extends ServerMsg["t"]>(t: T, timeoutMs = 3000, pred: (m: Extract<ServerMsg, { t: T }>) => boolean = () => true) {
    const found = this.msgs.find((m) => m.t === t && pred(m as Extract<ServerMsg, { t: T }>));
    if (found) return Promise.resolve(found as Extract<ServerMsg, { t: T }>);
    return new Promise<Extract<ServerMsg, { t: T }>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout waiting for ${t}`)), timeoutMs);
      this.waiters.push({
        pred: (m) => m.t === t && pred(m as Extract<ServerMsg, { t: T }>),
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m as Extract<ServerMsg, { t: T }>);
        },
      });
    });
  }

  async cmd(msg: Omit<Extract<ClientMsg, { t: "cmd" }>, "t">, timeoutMs = 4000): Promise<AckMsg> {
    this.send({ t: "cmd", ...msg });
    return this.next("ack", timeoutMs, (a) => a.id === msg.id);
  }

  close(): void {
    this.ws.close();
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
