/**
 * CommandRouter — UI `cmd` → IPC `in` → `ack`.
 * F0: press + hold (down/up). S2: set-state w pętli zamkniętej, keep-watchdog, rate limit, HOLD_MAX_MS.
 */
import {
  ACTIONS,
  type AckMsg,
  type CmdMsg,
  type ActionDef,
  type TelemetrySource,
  type GameStatus,
} from "@yoga-auto/protocol";

const ACK_TIMEOUT_MS = 2000;

interface Pending {
  resolve(ack: AckMsg): void;
  cmd: CmdMsg;
  at: number;
  timer: ReturnType<typeof setTimeout>;
}

export class CommandRouter {
  private seq = 0;
  private pending = new Map<number, Pending>();
  /** clientId → wejścia trzymane */
  private holds = new Map<string, Set<string>>();

  private readonly source: () => TelemetrySource;
  private readonly status: () => GameStatus;

  constructor(source: () => TelemetrySource, status: () => GameStatus) {
    this.source = source;
    this.status = status;
  }

  handle(cmd: CmdMsg, clientId: string): Promise<AckMsg> {
    const t0 = Date.now();
    const fail = (error: AckMsg["error"]): Promise<AckMsg> =>
      Promise.resolve({ t: "ack", id: cmd.id, ok: false, error, tookMs: Date.now() - t0 });
    const def = (ACTIONS as Record<string, ActionDef>)[cmd.action];
    if (!def) return fail("unknown_action");
    const st = this.status();
    if (!st.connected) return fail("game_not_connected");
    if (!st.inputEnabled) return fail("input_disabled");
    if (st.paused && cmd.action !== "ui.pause") return fail("game_paused");
    if (def.device === "keyboard") return fail("not_supported");

    const input = typeof def.scs === "string" ? def.scs : def.scs[0]!;
    if (def.kind === "press") return this.sendIn(cmd, def.device, input, "press");
    if (def.kind === "hold") {
      const set = this.holds.get(clientId) ?? new Set<string>();
      this.holds.set(clientId, set);
      if (cmd.op === "down") {
        set.add(input);
        return this.sendIn(cmd, def.device, input, "down");
      }
      if (cmd.op === "up") {
        set.delete(input);
        return this.sendIn(cmd, def.device, input, "up");
      }
      return Promise.resolve({ t: "ack", id: cmd.id, ok: true, tookMs: 0 }); // keep
    }
    return fail("not_supported"); // kind "set" — S2
  }

  /** Zwolnij wszystko, co trzymał klient (rozłączenie WS). */
  releaseClient(clientId: string): void {
    const set = this.holds.get(clientId);
    if (!set) return;
    for (const input of set) this.source().send({ t: "in", seq: ++this.seq, device: "semantical", input, op: "up" });
    this.holds.delete(clientId);
  }

  onInputAck(seq: number, ok: boolean): void {
    const p = this.pending.get(seq);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(seq);
    p.resolve({
      t: "ack",
      id: p.cmd.id,
      ok,
      ...(ok ? {} : { error: "not_supported" as const }),
      tookMs: Date.now() - p.at,
    });
  }

  private sendIn(
    cmd: CmdMsg,
    device: "semantical" | "generic",
    input: string,
    op: "press" | "down" | "up",
  ): Promise<AckMsg> {
    const seq = ++this.seq;
    const at = Date.now();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(seq);
        resolve({ t: "ack", id: cmd.id, ok: false, error: "timeout", tookMs: Date.now() - at });
      }, ACK_TIMEOUT_MS);
      this.pending.set(seq, { resolve, cmd, at, timer });
      this.source().send({ t: "in", seq, device, input, op });
    });
  }
}
