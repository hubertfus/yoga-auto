# s7-bug-ws-null-frame — `null` w ramce WS zabija bridge (S2)

Status: **WDROŻONE** przez S2 (branch claude/s2-bridge-62ab59, na main od 5d0f0a0).

**Błąd:** `bridge/src/server.ts`, `ws.on("message")`: `JSON.parse` zwraca `null` dla ramki `null`; `switch (msg.t)` rzuca `TypeError: Cannot read properties of null (reading 't')`. Handler jest `async`, więc to **unhandled rejection**, a w Node 24 domyślnie kończy proces.

**Skutek:** dowolny klient z LAN, który przejdzie autoryzację (albo każdy przy `--no-auth`), zabija bridge jedną ramką `null` (zły klient, fuzzing, błąd w UI).

**Repro:** `tests/bugs/bridge-process.test.ts`, test „WS frame `null` …” (bridge w procesie potomnym; po wysłaniu `null` proces ginie). Ręcznie:

```powershell
node bridge/src/main.ts --source mock --no-auth
# drugi terminal:
node -e "const W=require('ws');new W('ws://localhost:7420/ws',['yoga-auto.v1']).on('open',function(){this.send('null')})"
```

**Poprawka:**

```diff
       let msg: ClientMsg;
       try {
         msg = JSON.parse(String(data)) as ClientMsg;
       } catch {
         return;
       }
+      if (!msg || typeof msg !== "object" || typeof (msg as { t?: unknown }).t !== "string") return;
```

Dodatkowo handler `ws.on("message", async …)` powinien łapać wyjątki z `router.handle` i handlerów modułów (`try { … } catch (e) { log("error", …) }`), żeby jeden zły moduł nie zabijał procesu, oraz `process.on("unhandledRejection")` w `main.ts` jako ostatnia deska ratunku (log, dalej).

Po poprawce zamień w teście `knownBug` na `it`.
