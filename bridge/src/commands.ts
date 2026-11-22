/**
 * CommandRouter — UI `cmd` → IPC `in` → `ack` (PROTOCOL.md §4).
 *
 * - press: `in{press}`, ack po `in.ack` z pluginu.
 * - hold: `down` → (keep co ≤ 1 s) → `up`. Bridge sam zwalnia: po HOLD_MAX_MS, po HOLD_WATCHDOG_MS bez `keep`,
 *   po rozłączeniu klienta, po utracie źródła. Ten sam input trzymany przez kilku klientów = refcount.
 * - set: pętla zamknięta — porównaj stan, wyślij press, poczekaj na zmianę (≤ 500 ms), powtórz
 *   (maks. teoretyczna liczba kroków + 3), całość ≤ SET_TIMEOUT_MS.
 *   Obsługiwane: lights.mode, retarder.level, wipers.level (wycieraczki: bez weryfikacji, SDK nie raportuje stopnia).
 */
import {
  ACTIONS,
  HOLD_MAX_MS,
  HOLD_WATCHDOG_MS,
  SET_TIMEOUT_MS,
  type ActionDef,
  type AckMsg,
  type CmdMsg,
  type FullState,
  type TelemetrySource,
  type ipc,
} from "@yoga-auto/protocol";

const ACK_TIMEOUT_MS = 2000;
/** Maks. czekanie na zmianę stanu po jednym naciśnięciu (PROTOCOL.md §4). */
const STEP_WAIT_MS = 500;
/** Zapas ponad teoretyczną liczbę naciśnięć. */
const EXTRA_PRESSES = 3;

type Device = "semantical" | "generic";
type AckError = NonNullable<AckMsg["error"]>;

interface Pending {
  resolve(ok: boolean): void;
  timer: ReturnType<typeof setTimeout>;
}

interface Hold {
  device: Device;
  input: string;
  holders: Map<string, { keepTimer: ReturnType<typeof setTimeout>; maxTimer: ReturnType<typeof setTimeout> }>;
}

interface Waiter {
  check(): boolean;
  done(): void;
  timer: ReturnType<typeof setTimeout>;
}

/** Plan wykonania akcji `set`. */
interface SetPlan {
  /** kroki do celu liczone z bieżącego stanu; null = nie da się wyznaczyć (traktuj jak 1 bez weryfikacji) */
  remaining(): number | null;
  /** bieżąca wartość docelowa w postaci tekstu (null = nieznana) */
  current(): string | null;
  /** wejście do naciśnięcia w tym kroku */
  next(): { device: Device; input: string };
  /** true = jedno naciśnięcie i ack z pluginu, bez weryfikacji stanu */
  direct?: boolean;
}

export interface CommandRouterOptions {
  source: () => TelemetrySource;
  /** zawsze świeży stan (serwer stosuje zaległą telemetrię przed zwróceniem) */
  state: () => FullState;
  log?: (level: "debug" | "info" | "warn" | "error", msg: string) => void;
}

export class CommandRouter {
  private seq = 0;
  private readonly pending = new Map<number, Pending>();
  private readonly holds = new Map<string, Hold>();
  private readonly waiters = new Set<Waiter>();
  private readonly setChains = new Map<string, Promise<unknown>>();
  private inputs: ipc.IpcHello["inputs"] | null = null;
  private readonly opts: CommandRouterOptions;

  constructor(opts: CommandRouterOptions) {
    this.opts = opts;
  }

  // ───────────────────────────── zdarzenia ze źródła/serwera ─────────────────────────────

  /** `hello` z pluginu: lista zarejestrowanych wejść (do `not_supported`). */
  setInputs(inputs: ipc.IpcHello["inputs"] | null): void {
    this.inputs = inputs;
  }

  /** Serwer wywołuje po każdej aktualizacji stanu z telemetrii. */
  notifyState(): void {
    if (!this.waiters.size) return;
    for (const w of [...this.waiters]) if (w.check()) w.done();
  }

  onInputAck(seq: number, ok: boolean): void {
    const p = this.pending.get(seq);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(seq);
    p.resolve(ok);
  }

  /** Źródło się rozłączyło: plugin sam zwolnił wejścia (watchdog hb), więc tylko sprzątamy stan. */
  onSourceDisconnected(): void {
    for (const hold of this.holds.values())
      for (const h of hold.holders.values()) {
        clearTimeout(h.keepTimer);
        clearTimeout(h.maxTimer);
      }
    this.holds.clear();
    for (const [seq, p] of this.pending) {
      clearTimeout(p.timer);
      this.pending.delete(seq);
      p.resolve(false);
    }
    for (const w of [...this.waiters]) w.done();
  }

  /** Zwolnij wszystko, co trzymał klient (rozłączenie WS). */
  releaseClient(clientId: string): void {
    for (const key of [...this.holds.keys()]) this.releaseHold(key, clientId, "client disconnected");
  }

  /** Ostatni klient WS odszedł: wymuś zwolnienie po stronie pluginu. */
  releaseAll(): void {
    for (const key of [...this.holds.keys()]) {
      const hold = this.holds.get(key)!;
      for (const cid of [...hold.holders.keys()]) this.releaseHold(key, cid, "no clients");
    }
    this.opts.source().send({ t: "releaseAll" });
  }

  /** Ile wejść trzyma dany klient. */
  holdCount(clientId: string): number {
    let n = 0;
    for (const h of this.holds.values()) if (h.holders.has(clientId)) n++;
    return n;
  }

  // ───────────────────────────── cmd ─────────────────────────────

  handle(cmd: CmdMsg, clientId: string): Promise<AckMsg> {
    const t0 = Date.now();
    const ack = (ok: boolean, error?: AckError, state?: string): AckMsg => ({
      t: "ack",
      id: cmd.id,
      ok,
      ...(error ? { error } : {}),
      ...(state !== undefined ? { state } : {}),
      tookMs: Date.now() - t0,
    });
    const fail = (error: AckError) => Promise.resolve(ack(false, error));

    const def = (ACTIONS as Record<string, ActionDef>)[cmd.action];
    if (!def) return fail("unknown_action");

    // walidacja statyczna (niezależna od stanu gry)
    if (def.kind === "set") {
      if (typeof cmd.value !== "string" || !def.values?.includes(cmd.value)) return fail("invalid_value");
    } else if (def.kind === "hold") {
      if (cmd.op !== "down" && cmd.op !== "up" && cmd.op !== "keep") return fail("invalid_value");
    }

    const st = this.opts.state().status;
    if (!st.connected) return fail("game_not_connected");
    if (!st.inputEnabled) return fail("input_disabled");
    if (st.paused && cmd.action !== "ui.pause") return fail("game_paused");
    const device = def.device;
    if (device === "keyboard") return fail("not_supported");

    const inputs = ([] as string[]).concat(def.scs as string | string[]);
    if (inputs.some((i) => !this.supports(device, i))) return fail("not_supported");
    switch (def.kind) {
      case "press":
        return this.press(device, inputs[0]!).then((ok) => (ok ? ack(true) : ack(false, "not_supported")));
      case "hold":
        return this.hold(cmd, clientId, device, inputs[0]!).then((r) => ack(r.ok, r.error));
      case "set":
        return this.serialized(cmd.action, () => this.set(cmd, device, t0)).then((r) => ({
          ...ack(r.ok, r.error, r.state),
        }));
    }
  }

  // ───────────────────────────── press / hold ─────────────────────────────

  private supports(device: Device, input: string): boolean {
    if (!this.inputs) return true; // lista nieznana (np. źródło bez hello.inputs) — plugin odpowie in.ack ok:false
    return this.inputs[device].includes(input);
  }

  private press(device: Device, input: string, timeoutMs = ACK_TIMEOUT_MS): Promise<boolean> {
    return this.sendIn(device, input, "press", timeoutMs);
  }

  /** Wysyła `in` i czeka na `in.ack`. `false` = odrzucone przez plugin, timeout albo utrata źródła. */
  private sendIn(device: Device, input: string, op: "press" | "down" | "up", timeoutMs = ACK_TIMEOUT_MS): Promise<boolean> {
    const seq = ++this.seq;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(seq);
        resolve(false);
      }, timeoutMs);
      this.pending.set(seq, { resolve, timer });
      this.opts.source().send({ t: "in", seq, device, input, op });
    });
  }

  private async hold(
    cmd: CmdMsg,
    clientId: string,
    device: Device,
    input: string,
  ): Promise<{ ok: boolean; error?: AckError }> {
    const key = `${device}:${input}`;
    let hold = this.holds.get(key);
    if (cmd.op === "keep") {
      const h = hold?.holders.get(clientId);
      if (!h) return { ok: false, error: "invalid_value" }; // nie trzymasz (bridge już zwolnił) — UI ma cofnąć stan
      clearTimeout(h.keepTimer);
      h.keepTimer = setTimeout(() => this.releaseHold(key, clientId, "no keep"), HOLD_WATCHDOG_MS);
      return { ok: true };
    }
    if (cmd.op === "up") {
      if (!hold?.holders.has(clientId)) return { ok: true }; // idempotentne
      this.releaseHold(key, clientId, "up");
      return { ok: true };
    }
    // down
    if (hold?.holders.has(clientId)) {
      const h = hold.holders.get(clientId)!;
      clearTimeout(h.keepTimer);
      h.keepTimer = setTimeout(() => this.releaseHold(key, clientId, "no keep"), HOLD_WATCHDOG_MS);
      return { ok: true };
    }
    const first = !hold;
    if (!hold) {
      hold = { device, input, holders: new Map() };
      this.holds.set(key, hold);
    }
    hold.holders.set(clientId, {
      keepTimer: setTimeout(() => this.releaseHold(key, clientId, "no keep"), HOLD_WATCHDOG_MS),
      maxTimer: setTimeout(() => this.releaseHold(key, clientId, "max duration"), HOLD_MAX_MS),
    });
    if (!first) return { ok: true };
    const ok = await this.sendIn(device, input, "down");
    if (!ok) {
      this.releaseHold(key, clientId, "down failed", false);
      return { ok: false, error: "not_supported" };
    }
    return { ok: true };
  }

  private releaseHold(key: string, clientId: string, reason: string, sendUp = true): void {
    const hold = this.holds.get(key);
    const h = hold?.holders.get(clientId);
    if (!hold || !h) return;
    clearTimeout(h.keepTimer);
    clearTimeout(h.maxTimer);
    hold.holders.delete(clientId);
    if (hold.holders.size) return;
    this.holds.delete(key);
    if (sendUp) {
      this.opts.source().send({ t: "in", seq: ++this.seq, device: hold.device, input: hold.input, op: "up" });
      this.opts.log?.("debug", `hold ${key} released (${reason})`);
    }
  }

  // ───────────────────────────── set (pętla zamknięta) ─────────────────────────────

  private serialized<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.setChains.get(key) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.setChains.set(key, next);
    void next.finally(() => {
      if (this.setChains.get(key) === next) this.setChains.delete(key);
    });
    return next;
  }

  private plan(cmd: CmdMsg, device: Device): SetPlan | null {
    const value = cmd.value!;
    const fast = () => this.opts.state().fast;
    switch (cmd.action) {
      case "lights.mode": {
        const order = ["off", "parking", "low"] as const;
        const idx = () => {
          const l = fast().lights;
          return l.low ? 2 : l.parking ? 1 : 0;
        };
        const target = order.indexOf(value as (typeof order)[number]);
        return {
          remaining: () => (target - idx() + 3) % 3,
          current: () => order[idx()]!,
          next: () => ({ device, input: "light" }),
        };
      }
      case "retarder.level": {
        const target = Number(value);
        return {
          remaining: () => Math.abs(target - fast().retarder),
          current: () => String(fast().retarder),
          next: () => ({ device, input: fast().retarder < target ? "retarderup" : "retarderdown" }),
        };
      }
      case "wipers.level":
        return {
          remaining: () => 1,
          current: () => null,
          next: () => ({ device, input: `wipers${value}` }),
          direct: true,
        };
      default:
        return null;
    }
  }

  private async set(
    cmd: CmdMsg,
    device: Device,
    t0: number,
  ): Promise<{ ok: boolean; error?: AckError; state?: string }> {
    const value = cmd.value!;
    const plan = this.plan(cmd, device);
    if (!plan) return { ok: false, error: "not_supported" };

    if (cmd.action === "retarder.level") {
      const steps = this.opts.state().config.truck?.retarderSteps;
      if (steps !== undefined && steps > 0 && Number(value) > steps) return { ok: false, error: "invalid_value" };
    }

    const deadline = t0 + SET_TIMEOUT_MS;
    const left = () => deadline - Date.now();

    if (plan.direct) {
      const ok = await this.press(plan.next().device, plan.next().input, Math.max(1, left()));
      return ok ? { ok: true, state: value } : { ok: false, error: left() <= 0 ? "timeout" : "not_supported" };
    }

    const initial = plan.remaining() ?? 1;
    const maxPresses = initial + EXTRA_PRESSES;
    let presses = 0;
    for (;;) {
      const cur = plan.current();
      if (cur === value) return { ok: true, state: value };
      if (left() <= 0 || presses >= maxPresses) return { ok: false, error: "timeout", ...(cur ? { state: cur } : {}) };
      const step = plan.next();
      const ok = await this.press(step.device, step.input, Math.max(1, Math.min(ACK_TIMEOUT_MS, left())));
      presses++;
      if (!ok) {
        if (left() <= 0) return { ok: false, error: "timeout", ...(cur ? { state: cur } : {}) };
        if (!this.opts.state().status.connected) return { ok: false, error: "game_not_connected" };
        return { ok: false, error: "not_supported" };
      }
      await this.waitFor(() => plan.current() !== cur, Math.min(STEP_WAIT_MS, Math.max(0, left())));
    }
  }

  /** Czeka, aż `check()` zwróci true (sprawdzane po każdej aktualizacji stanu) albo upłynie czas. */
  private waitFor(check: () => boolean, timeoutMs: number): Promise<boolean> {
    if (check()) return Promise.resolve(true);
    if (timeoutMs <= 0) return Promise.resolve(false);
    return new Promise((resolve) => {
      const w: Waiter = {
        check,
        done: () => {
          clearTimeout(w.timer);
          this.waiters.delete(w);
          resolve(check());
        },
        timer: setTimeout(() => w.done(), timeoutMs),
      };
      this.waiters.add(w);
    });
  }
}
