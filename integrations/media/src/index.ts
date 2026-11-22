/** @yoga-auto/media: SmtcMediaProvider (Windows), AutoMediaProvider (SMTC → fallback Null), Null/Mock. */
export { MockMediaProvider, NullMediaProvider } from "./mock.ts";
export { SmtcMediaProvider, defaultSpawn, type HelperProcess, type SmtcOptions, type SpawnHelper } from "./smtc.ts";
export { AutoMediaProvider, createMediaProvider, type AutoMediaOptions } from "./factory.ts";
export { parseLine, toMediaState, trackKey, type HelperMsg, type HelperRawState } from "./helper-protocol.ts";
