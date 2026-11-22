/** Media w bridge: snapshot zawiera stan z providera, parsowanie --media. */
import { afterEach, describe, expect, it } from "vitest";
import { MockMediaProvider } from "@yoga-auto/media";
import { createMockSource } from "@yoga-auto/mock";
import { createMediaModule } from "../src/modules/media.ts";
import { resolveMediaMode } from "../src/modules/media-mode.ts";
import { startBridge } from "../src/server.ts";
import { TestClient } from "./ws-client.ts";

const open: { close(): unknown }[] = [];
afterEach(async () => {
  for (const o of open.splice(0).reverse()) await o.close();
});

describe("snapshot z mediami", () => {
  it("snapshot zawiera media z MockMediaProvider (nie null)", async () => {
    const provider = new MockMediaProvider();
    const b = await startBridge({
      source: createMockSource({ scenario: "highway" }),
      port: 0,
      host: "127.0.0.1",
      auth: false,
      log: () => {},
      modules: [createMediaModule(provider)],
    });
    open.push(b);
    const c = new TestClient(b.port);
    open.push(c);
    await c.opened();
    const snap = await c.next("snapshot");
    expect(snap.state.media).not.toBeNull();
    expect(snap.state.media).toMatchObject({ title: provider.getState()!.title, artist: provider.getState()!.artist });
    expect(b.store.state.media?.title).toBeTruthy();
  });
});

describe("--media", () => {
  it("domyślnie: mock dla source mock, inaczej auto", () => {
    expect(resolveMediaMode({}, "mock")).toBe("mock");
    expect(resolveMediaMode({}, "pipe")).toBe("auto");
    expect(resolveMediaMode({}, "replay")).toBe("auto");
  });
  it("jawne wartości i alias --mock-media", () => {
    for (const m of ["auto", "mock", "null", "off"] as const) expect(resolveMediaMode({ media: m }, "mock")).toBe(m);
    expect(resolveMediaMode({ "mock-media": true }, "pipe")).toBe("mock");
    expect(resolveMediaMode({ media: "off", "mock-media": true }, "pipe")).toBe("off");
  });
  it("zła wartość → błąd", () => {
    expect(() => resolveMediaMode({ media: "spotify" }, "pipe")).toThrow(/--media/);
  });
});
