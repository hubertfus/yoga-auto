/**
 * Symulowane „źródło + gra” do testów CommandRouter: reaguje na `in` jak plugin (ack po 1 klatce, efekt po
 * 3 klatkach), z wstrzykiwaniem awarii. Czas = timery Vitest (fake timers).
 */
import { ACTIONS, type TelemetrySource, type ipc } from "@yoga-auto/protocol";
import { CommandRouter } from "../src/commands.ts";
import { StateStore } from "../src/store.ts";

export const FRAME_MS = 16;

export function allInputs(): ipc.IpcHello["inputs"] {
  const s = new Set<string>();
  for (const a of Object.values(ACTIONS)) for (const n of ([] as string[]).concat(a.scs as string | string[])) s.add(n);
  return { semantical: [...s], generic: [] };
}

export class SimSource implements TelemetrySource {
  readonly kind = "mock" as const;
  readonly sent: ipc.IpcToPlugin[] = [];
  readonly store = new StateStore("mock");
  router!: CommandRouter;
  /** ile kolejnych naciśnięć `light`/`retarder*` zignorować (gra „zgubiła” wejście) */
  dropPresses = 0;
  /** nie odsyłaj `in.ack` */
  silent = false;
  /** odrzucaj wejścia (ok:false) */
  rejectAll = false;
  lightsMode = 0;

  constructor() {
    this.store.setStatus({ connected: true, inputEnabled: true, game: "ets2" });
  }

  attach(): CommandRouter {
    this.router = new CommandRouter({ source: () => this, state: () => this.store.state });
    this.router.setInputs(allInputs());
    return this.router;
  }

  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  onMessage(): () => void {
    return () => {};
  }

  presses(input?: string): ipc.IpcInput[] {
    return this.sent.filter(
      (m): m is ipc.IpcInput => m.t === "in" && m.op === "press" && (input === undefined || m.input === input),
    );
  }

  ops(op: "down" | "up"): ipc.IpcInput[] {
    return this.sent.filter((m): m is ipc.IpcInput => m.t === "in" && m.op === op);
  }

  send(msg: ipc.IpcToPlugin): void {
    this.sent.push(msg);
    if (msg.t !== "in") return;
    if (!this.silent) setTimeout(() => this.router.onInputAck(msg.seq, !this.rejectAll), FRAME_MS);
    if (this.rejectAll || msg.op !== "press") return;
    setTimeout(() => this.apply(msg.input), 3 * FRAME_MS);
  }

  private apply(input: string): void {
    if (this.dropPresses > 0 && (input === "light" || input.startsWith("retarder"))) {
      this.dropPresses--;
      return;
    }
    const f = this.store.state.fast;
    switch (input) {
      case "light":
        this.lightsMode = (this.lightsMode + 1) % 3;
        this.store.setFast("lights", { ...f.lights, parking: this.lightsMode >= 1, low: this.lightsMode === 2 });
        break;
      case "retarderup":
        this.store.setFast("retarder", Math.min(5, f.retarder + 1));
        break;
      case "retarderdown":
        this.store.setFast("retarder", Math.max(0, f.retarder - 1));
        break;
      default:
        break;
    }
    this.router.notifyState();
  }
}
