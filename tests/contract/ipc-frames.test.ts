/**
 * Referencyjny dekoder ramek (TS) musi zachowywać się zgodnie z manifestem złotych ramek —
 * to samo ma robić parser C++ (tests/contract/README.md). Plus: pliki w repo są aktualne.
 */
import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FrameDecoder } from "@yoga-auto/fake-pipe";
import { buildFrames, framesDir, readFrame } from "./ipc-frames.ts";
import { violations } from "../support/schemas.ts";

const { manifest, files } = buildFrames();

function feed(buf: Buffer, chunk: number) {
  const d = new FrameDecoder();
  const out = [];
  for (let i = 0; i < buf.length; i += chunk) out.push(...d.push(buf.subarray(i, i + chunk)));
  return { out, pending: d.pending };
}

describe("golden IPC frames", () => {
  it("committed files are up to date (run: node tests/contract/ipc-frames.ts)", () => {
    const onDisk = readdirSync(framesDir)
      .filter((f) => f.endsWith(".bin"))
      .sort();
    expect(onDisk).toEqual([...files.keys()].sort());
    for (const [name, buf] of files) expect(readFrame(name).equals(buf), name).toBe(true);
  });

  for (const c of manifest.cases) {
    for (const chunk of [1, 3, 7, 1 << 20]) {
      it(`${c.file} @ chunk=${chunk === 1 << 20 ? "whole" : chunk}`, () => {
        const { out, pending } = feed(files.get(c.file)!, chunk);
        switch (c.expect) {
          case "messages": {
            const ok = out.filter((r) => r.ok);
            expect(ok.map((r) => (r.ok ? (r.msg as { t: string }).t : ""))).toEqual(c.t);
            for (const r of ok)
              if (r.ok)
                expect(violations("fromPlugin", r.msg) === null || violations("toPlugin", r.msg) === null).toBe(true);
            if (c.events) expect(out.map((r) => (r.ok ? "message" : r.error))).toEqual(c.events);
            else expect(out.every((r) => r.ok)).toBe(true);
            expect(pending).toBe(0);
            break;
          }
          case "bad_json": {
            const r = out[0];
            // null/array/number/no-t są poprawnym JSON-em: dekoder ramek je zwraca, ale walidacja kształtu je odrzuca
            const shapeInvalid =
              r?.ok && violations("fromPlugin", r.msg) !== null && violations("toPlugin", r.msg) !== null;
            expect(!r?.ok || shapeInvalid, c.file).toBe(true);
            break;
          }
          case "too_large":
            expect(out).toHaveLength(1);
            expect(out[0]).toMatchObject({ ok: false, error: "too_large" });
            break;
          case "incomplete":
            expect(out).toEqual([]);
            expect(pending).toBeGreaterThan(0);
            break;
        }
      });
    }
  }
});
