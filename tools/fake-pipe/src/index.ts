export { FakePipeServer, type FakePipeOptions, type FakePipeStats, type FakePipeEvents } from "./server.ts";
export { encodeFrame, encodeRaw, FrameDecoder, testPipePath, type DecodeResult } from "./framing.ts";
export { parseFaults, garbagePayload, GARBAGE_KINDS, type FaultSpec, type GarbageKind } from "./faults.ts";
export { PipeTestClient } from "./client.ts";
