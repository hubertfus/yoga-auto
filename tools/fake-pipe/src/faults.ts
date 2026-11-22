/** Tryby awarii fake-pipe. Wszystkie domyślnie wyłączone = zachowanie poprawnego pluginu. */

export type GarbageKind =
  | "not-json" // losowe bajty ASCII, nie JSON
  | "invalid-utf8" // bajty 0xff 0xfe …
  | "empty" // ramka długości 0
  | "null" // `null`
  | "array" // `[1,2,3]`
  | "number" // `42`
  | "no-t" // obiekt bez pola t
  | "unknown-t" // obiekt z nieznanym t (zgodność w przód: bridge MUSI ignorować)
  | "bad-tel" // `tel` niezgodny ze schematem (ch: null, frame: string)
  | "bad-cfg"; // `cfg` z attrs jako string

export const GARBAGE_KINDS: readonly GarbageKind[] = [
  "not-json",
  "invalid-utf8",
  "empty",
  "null",
  "array",
  "number",
  "no-t",
  "unknown-t",
  "bad-tel",
  "bad-cfg",
];

export interface FaultSpec {
  /** zrywaj połączenie co N ms (licząc od nawiązania) */
  dropEveryMs?: number;
  /** zerwij połączenie po wysłaniu N ramek `tel` */
  dropAfterFrames?: number;
  /** prawdopodobieństwo (0..1) wstrzyknięcia śmieciowej ramki przed każdą ramką `tel` */
  garbageRate?: number;
  /** rodzaje śmieci do losowania (domyślnie wszystkie) */
  garbageKinds?: GarbageKind[];
  /** po N ms od połączenia wyślij ramkę z długością > IPC_MAX_FRAME_BYTES */
  oversizeAfterMs?: number;
  /** dziel zapisy na kawałki maks. N bajtów (true = 7) — testuje składanie ramek u klienta */
  fragment?: boolean | number;
  /** po N ms od połączenia przestań wysyłać `tel` (zawieszona gra / ekran ładowania) … */
  stallAfterMs?: number;
  /** … na N ms (domyślnie 5000) */
  stallMs?: number;
  /** opóźnienie `in.ack` w ms */
  ackDelayMs?: number;
  /** nie wysyłaj `in.ack` (test timeoutu ack w bridge'u) */
  dropAcks?: boolean;
  /** wymuś `ok:false` w każdym `in.ack` */
  ackFail?: boolean;
  /** nadpisz `hello.ipc` (np. 2 = niezgodna wersja) */
  ipcVersion?: number;
  /** nie wysyłaj `hello` po połączeniu */
  noHello?: boolean;
  /** nie wysyłaj `in.ack`, nie stosuj wejść i nie odpowiadaj na nic — tylko telemetria (plugin z wyłączonym input API) */
  inputDisabled?: boolean;
}

/** Parsuje skrót CLI, np. `drop:5000,garbage:0.05,oversize:10000,stall:3000/4000,ack-delay:200,drop-acks,ipc:2,fragment:5`. */
export function parseFaults(spec: string | undefined): FaultSpec {
  const f: FaultSpec = {};
  if (!spec) return f;
  for (const part of spec
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)) {
    const [k, v = ""] = part.split(":");
    const n = Number(v);
    switch (k) {
      case "drop":
        f.dropEveryMs = n;
        break;
      case "drop-frames":
        f.dropAfterFrames = n;
        break;
      case "garbage":
        f.garbageRate = v ? n : 0.05;
        break;
      case "garbage-kinds":
        f.garbageKinds = v.split("+") as GarbageKind[];
        break;
      case "oversize":
        f.oversizeAfterMs = v ? n : 0;
        break;
      case "fragment":
        f.fragment = v ? n : true;
        break;
      case "stall": {
        const [after, len] = v.split("/");
        f.stallAfterMs = Number(after || 0);
        if (len) f.stallMs = Number(len);
        break;
      }
      case "ack-delay":
        f.ackDelayMs = n;
        break;
      case "drop-acks":
        f.dropAcks = true;
        break;
      case "ack-fail":
        f.ackFail = true;
        break;
      case "ipc":
        f.ipcVersion = n;
        break;
      case "no-hello":
        f.noHello = true;
        break;
      case "input-disabled":
        f.inputDisabled = true;
        break;
      default:
        throw new Error(`unknown fault "${k}"`);
    }
  }
  return f;
}

/** Payload śmieciowej ramki. */
export function garbagePayload(kind: GarbageKind, rand: () => number): Buffer {
  switch (kind) {
    case "not-json": {
      const n = 8 + Math.floor(rand() * 32);
      let s = "";
      for (let i = 0; i < n; i++) s += String.fromCharCode(33 + Math.floor(rand() * 90));
      return Buffer.from(`{${s}`, "ascii");
    }
    case "invalid-utf8":
      return Buffer.from([0x7b, 0x22, 0xff, 0xfe, 0xc3, 0x28, 0x7d]);
    case "empty":
      return Buffer.alloc(0);
    case "null":
      return Buffer.from("null");
    case "array":
      return Buffer.from("[1,2,3]");
    case "number":
      return Buffer.from("42");
    case "no-t":
      return Buffer.from(JSON.stringify({ foo: 1, frame: 3 }));
    case "unknown-t":
      return Buffer.from(JSON.stringify({ t: "future.thing", x: 1 }));
    case "bad-tel":
      return Buffer.from(JSON.stringify({ t: "tel", frame: "x", simTime: null, paused: "no", ch: null }));
    case "bad-cfg":
      return Buffer.from(JSON.stringify({ t: "cfg", id: 7, attrs: "oops" }));
  }
}
