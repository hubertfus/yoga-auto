/** Adapter MediaProvider (integrations/media, S6) → BridgeModule. */
import { createHash } from "node:crypto";
import type { MediaProvider } from "@yoga-auto/protocol";
import type { BridgeContext, BridgeModule } from "./types.ts";

export function createMediaModule(provider: MediaProvider): BridgeModule {
  const offs: (() => void)[] = [];
  return {
    name: `media:${provider.name}`,
    capability: "media",
    async start(ctx: BridgeContext) {
      await provider.start();
      ctx.setMedia(provider.getState());
      offs.push(
        provider.onChange((media) => {
          ctx.setMedia(media);
          ctx.broadcast({ t: "media", ts: Date.now(), media });
        }),
      );
      offs.push(
        ctx.onClientConnected((id) => ctx.sendTo(id, { t: "media", ts: Date.now(), media: provider.getState() })),
      );
      offs.push(
        ctx.onClientMsg("media", async (msg, clientId) => {
          const t0 = Date.now();
          try {
            await provider.command(msg.action, msg.value);
            ctx.sendTo(clientId, { t: "ack", id: msg.id, ok: true, tookMs: Date.now() - t0 });
          } catch {
            ctx.sendTo(clientId, { t: "ack", id: msg.id, ok: false, error: "not_supported", tookMs: Date.now() - t0 });
          }
        }),
      );
      if (provider.getArt) {
        const getArt = provider.getArt.bind(provider);
        ctx.registerStatic("/media/art/", async (path) => {
          const hash = path.replace(/\.jpg$/, "");
          const art = await getArt(hash);
          return art ? { ...art, maxAgeS: 86400 } : null;
        });
      }
    },
    async stop() {
      offs.splice(0).forEach((f) => f());
      await provider.stop();
    },
  };
}

export const artHash = (data: Uint8Array): string => createHash("sha1").update(data).digest("hex").slice(0, 16);
