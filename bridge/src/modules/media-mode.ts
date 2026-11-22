/** Opcja CLI `--media auto|mock|null|off` (+ alias `--mock-media`). */
export const MEDIA_MODES = ["auto", "mock", "null", "off"] as const;
export type MediaMode = (typeof MEDIA_MODES)[number];

export function resolveMediaMode(
  cli: { media?: string | undefined; "mock-media"?: boolean | undefined },
  source: string,
): MediaMode {
  if (cli.media !== undefined) {
    if (!(MEDIA_MODES as readonly string[]).includes(cli.media))
      throw new Error(`zły --media ${cli.media} (${MEDIA_MODES.join(" | ")})`);
    return cli.media as MediaMode;
  }
  return cli["mock-media"] || source === "mock" ? "mock" : "auto";
}
