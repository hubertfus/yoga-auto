# s7-recorder-hook — hook nagrywania w bridge'u + `--source replay` (dla S2)

Status: **WDROŻONE** przez S2 (branch claude/s2-bridge-62ab59, na main od 5d0f0a0).

**Co:** `startBridge` przyjmuje opcjonalny `recorder` (interfejs z `@yoga-auto/recorder`), a `main.ts` dostaje `--record <plik>` oraz `--source replay --replay plik.yarec [--speed X] [--loop]`.
**Dlaczego:** DoD S7 i checklista sesji z grą (`bridge --source pipe --record`) — prawdziwe nagrania z gry jako wejście dla testów UI i bench bez ETS2.
**Wpływ:** tylko S2 (`bridge/src/server.ts`, `main.ts`, `package.json`). Zmiana jest addytywna: bez `recorder` zachowanie jest identyczne. `hello.capabilities.record = !!recorder`.

Interfejs (gotowy i przetestowany: `tools/recorder/src/recorder.ts`):

```ts
export interface Recorder {
  readonly file: string;
  ipc(msg: SourceMsg): void; // wiadomość źródła, także connected/disconnected
  ws(msg: ServerMsg, clientId?: string): void; // wiadomość bridge → UI
  flush(): void; // Z_SYNC_FLUSH (czytelny plik po crashu)
  close(): Promise<void>;
}
```

`YarecRecorder(file, { ws?: boolean, wsSkipFast?: boolean, meta? })` zapisuje gzip JSONL `{ts, kind, msg}`; patrz `tools/recorder/README.md`.

## Diff `bridge/src/server.ts`

```diff
+import type { Recorder } from "@yoga-auto/recorder";
 export interface BridgeOptions {
   source: TelemetrySource;
+  /** nagrywanie sesji do .yarec (S7) */
+  recorder?: Recorder;
 ...
   const send = (c: Client, msg: ServerMsg) => {
-    if (c.ws.readyState === c.ws.OPEN) c.ws.send(JSON.stringify(msg));
+    if (c.ws.readyState === c.ws.OPEN) {
+      c.ws.send(JSON.stringify(msg));
+      opts.recorder?.ws(msg, c.id);
+    }
   };
   const broadcast = (msg: ServerMsg) => {
     const s = JSON.stringify(msg);
+    opts.recorder?.ws(msg); // raz, nie per klient
     for (const c of clients.values()) if (c.ws.readyState === c.ws.OPEN) c.ws.send(s);
   };
 ...
   opts.source.onMessage((m: SourceMsg) => {
+    opts.recorder?.ipc(m);
     switch (m.t) {
 ...
-  const capabilities = { input: true, media: ..., map: false, record: false };
+  const capabilities = { input: true, media: ..., map: false, record: !!opts.recorder };
 ...
   async close() {
 ...
+      await opts.recorder?.close();
```

`fast` jest wysyłane per klient (własne `fastHz`, filtr `placement`) przez `send`, więc rekorduje się z `clientId`; reszta przez `broadcast` raz.

## Diff `bridge/src/main.ts`

```diff
+import { YarecRecorder, ReplaySource } from "@yoga-auto/recorder";
 const { values } = parseArgs({
   options: {
+    record: { type: "string" }, // --record plik.yarec
+    replay: { type: "string" },
+    speed: { type: "string", default: "1" },
+    loop: { type: "boolean", default: false },
 ...
+} else if (values.source === "replay") {
+  if (!values.replay) throw new Error("--source replay requires --replay <plik.yarec>");
+  source = new ReplaySource({ file: values.replay, speed: Number(values.speed), loop: values.loop });
 } else {
-  throw new Error(`unknown --source ${values.source} (mock | pipe)`);
+  throw new Error(`unknown --source ${values.source} (mock | pipe | replay)`);
 }
+const recorder = values.record
+  ? new YarecRecorder(values.record, { meta: { source: values.source } })
+  : undefined;
 ...
 const bridge = await startBridge({ ..., ...(recorder ? { recorder } : {}) });
 ...
 const shutdown = async () => {
+  recorder?.flush();
   await bridge.close();
```

`bridge/package.json`: `"@yoga-auto/recorder": "*"`.

## Test akceptacyjny (już w repo)

`tests/recorder/record-replay.test.ts` (S7) nagrywa przez opakowanie źródła i odtwarza przez `ReplaySource` w drugim bridge'u. Po wdrożeniu hooka dopiszę wariant `startBridge({ recorder })` (test jest już napisany jako `it.runIf(hookPresent)`).
