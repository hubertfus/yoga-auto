/**
 * Złote ramki IPC (bajty z pipe) dla testów C++ (S1) i innych implementacji parsera ramek.
 * Generuje `tests/contract/frames/*.bin` + `manifest.json` z fixture'ów `shared/protocol/fixtures/ipc`
 * i z przypadków brzegowych. Uruchom:  node tests/contract/ipc-frames.ts   (test sprawdza, że pliki są aktualne).
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ipc } from "@yoga-auto/protocol";
import { encodeFrame, encodeRaw } from "@yoga-auto/fake-pipe";
import { loadFixtures } from "../support/schemas.ts";

export interface FrameCase {
  /** nazwa pliku w frames/ */
  file: string;
  /** co parser MUSI zrobić z całym plikiem podanym jako strumień (dowolnie pocięty na kawałki) */
  expect: "messages" | "bad_json" | "too_large" | "incomplete";
  /** dla "messages": wartości `t` kolejnych poprawnych wiadomości */
  t?: string[];
  /** kolejność oczekiwanych zdarzeń przy mieszanych strumieniach */
  events?: ("message" | "bad_json")[];
  note: string;
}

export interface Manifest {
  maxFrameBytes: number;
  /** wszystkie pliki: uint32 LE długość + UTF-8 payload, bez żadnych innych separatorów */
  cases: FrameCase[];
}

export const framesDir = resolve(import.meta.dirname, "frames");

export function buildFrames(): { manifest: Manifest; files: Map<string, Buffer> } {
  const files = new Map<string, Buffer>();
  const cases: FrameCase[] = [];
  const add = (c: FrameCase, buf: Buffer) => {
    files.set(c.file, buf);
    cases.push(c);
  };

  // 1) każdy fixture IPC jako osobna ramka
  for (const { name, msg } of loadFixtures("ipc")) {
    const t = (msg as { t: string }).t;
    add(
      { file: `valid-${name.replace(/\.json$/, "")}.bin`, expect: "messages", t: [t], note: `fixture ipc/${name}` },
      encodeFrame(msg),
    );
  }

  // 2) strumień: kilka ramek jedna za drugą (+ test dzielenia na kawałki po stronie runnera)
  const fixtures = loadFixtures("ipc");
  add(
    {
      file: "valid-stream-all.bin",
      expect: "messages",
      t: fixtures.map((f) => (f.msg as { t: string }).t),
      note: "wszystkie fixture'y IPC jedna po drugiej; podawaj w kawałkach 1, 3, 7 bajtów i całością",
    },
    Buffer.concat(fixtures.map((f) => encodeFrame(f.msg))),
  );

  // 3) Unicode (wielobajtowe znaki: długość to BAJTY, nie znaki)
  add(
    { file: "valid-unicode.bin", expect: "messages", t: ["log"], note: "długość w bajtach UTF-8 (ą, 🚚)" },
    encodeFrame({ t: "log", level: "info", msg: "Wrocław → Hamburg 🚚 zażółć gęślą jaźń" }),
  );

  // 4) największa dozwolona ramka (dokładnie limit) i o 1 większa
  const pad = (n: number) => {
    const base = '{"t":"log","level":"info","msg":"';
    const tail = '"}';
    return Buffer.from(base + "x".repeat(n - base.length - tail.length) + tail, "utf8");
  };
  add(
    {
      file: "valid-max-size.bin",
      expect: "messages",
      t: ["log"],
      note: `payload dokładnie ${ipc.IPC_MAX_FRAME_BYTES} B — dozwolony`,
    },
    encodeRaw(pad(ipc.IPC_MAX_FRAME_BYTES)),
  );
  add(
    {
      file: "invalid-oversize.bin",
      expect: "too_large",
      note: `nagłówek mówi ${ipc.IPC_MAX_FRAME_BYTES + 1} B (> limit): zerwij połączenie, nie czekaj na payload`,
    },
    encodeRaw(Buffer.alloc(1024, 0x20), ipc.IPC_MAX_FRAME_BYTES + 1),
  );
  add(
    { file: "invalid-huge-length.bin", expect: "too_large", note: "długość 0xFFFFFFFF" },
    encodeRaw(Buffer.alloc(16, 0x20), 0xffffffff),
  );

  // 5) śmieci w payloadzie
  add(
    { file: "invalid-not-json.bin", expect: "bad_json", note: "payload `{oops` — pomiń ramkę, połączenie żyje" },
    encodeRaw("{oops"),
  );
  add(
    { file: "invalid-empty.bin", expect: "bad_json", note: "długość 0 — pusty payload nie jest JSON-em" },
    encodeRaw(""),
  );
  add(
    { file: "invalid-utf8.bin", expect: "bad_json", note: "bajty 0xFF 0xFE w środku — niepoprawny UTF-8" },
    encodeRaw(Buffer.from([0x7b, 0x22, 0xff, 0xfe, 0xc3, 0x28, 0x7d])),
  );
  // 6) JSON poprawny, ale nie jest obiektem IPC — C++ ma go odrzucić na etapie interpretacji, nie padać
  for (const [file, body] of [
    ["invalid-json-null.bin", "null"],
    ["invalid-json-array.bin", "[1,2,3]"],
    ["invalid-json-number.bin", "42"],
    ["invalid-json-no-t.bin", '{"foo":1}'],
  ] as const) {
    add(
      {
        file,
        expect: "bad_json",
        note: `payload \`${body}\` — poprawny JSON, ale nie wiadomość IPC (brak \`t\`): odrzuć`,
      },
      encodeRaw(body),
    );
  }

  // 7) niepełne ramki
  const full = encodeFrame({ t: "hb" });
  add(
    {
      file: "incomplete-header.bin",
      expect: "incomplete",
      note: "tylko 3 bajty nagłówka: czekaj na resztę, nic nie emituj",
    },
    full.subarray(0, 3),
  );
  add(
    { file: "incomplete-body.bin", expect: "incomplete", note: "nagłówek + część payloadu: czekaj, nic nie emituj" },
    full.subarray(0, full.length - 2),
  );

  // 8) mieszany strumień: dobra, zła, dobra — parser MUSI wrócić do synchronizacji (długość jest znana)
  add(
    {
      file: "mixed-good-bad-good.bin",
      expect: "messages",
      events: ["message", "bad_json", "message"],
      t: ["hb", "hb"],
      note: "hb, śmieć o poprawnej długości, hb — po złej ramce parser nadal czyta następną",
    },
    Buffer.concat([encodeFrame({ t: "hb" }), encodeRaw("{oops"), encodeFrame({ t: "hb" })]),
  );

  return { manifest: { maxFrameBytes: ipc.IPC_MAX_FRAME_BYTES, cases }, files };
}

export function writeFrames(): void {
  const { manifest, files } = buildFrames();
  rmSync(framesDir, { recursive: true, force: true });
  mkdirSync(framesDir, { recursive: true });
  for (const [name, buf] of files) writeFileSync(resolve(framesDir, name), buf);
  writeFileSync(resolve(framesDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`wrote ${files.size} frames to ${framesDir}`);
}

export function readFrame(name: string): Buffer {
  return readFileSync(resolve(framesDir, name));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) writeFrames();
