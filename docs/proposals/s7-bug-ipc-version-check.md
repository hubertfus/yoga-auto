# s7-bug-ipc-version-check — bridge nie sprawdza `hello.ipc` (S2)

Status: **WDROŻONE** przez S2 (branch claude/s2-bridge-62ab59, na main od 5d0f0a0).

**Błąd:** PROTOCOL.md §1: „`hello.ipc` musi = `IPC_VERSION`”. `server.ts` na `hello` ustawia `connected:true` bez porównania wersji; plugin z IPC v2 jest traktowany jak v1.

**Skutek:** po zmianie kontraktu (nowy plugin + stary bridge albo odwrotnie) bridge cicho działa na niezgodnych danych zamiast pokazać błąd „zaktualizuj plugin/bridge”.

**Repro:** `tests/bugs/bridge-process.test.ts`, test „plugin hello with a different IPC version …” (fake-pipe z `ipcVersion: 2`).

**Poprawka (propozycja):**

```diff
       case "hello":
+        if (m.ipc !== IPC_VERSION) {
+          log("error", `plugin speaks IPC v${m.ipc}, bridge expects v${IPC_VERSION}: refusing`);
+          store.setStatus({ connected: false });
+          ipcMismatch = true; // ignoruj dalsze tel/cfg/evt do reconnectu
+          break;
+        }
         store.setStatus({ connected: true, ...
```

Alert dla UI (nowy `AlertCode`, np. `"plugin.version"`) wymaga zmiany kontraktu (osobna propozycja do leada). Na start wystarczy log + `connected:false`.

Po poprawce zamień w teście `knownBug` na `it`.
