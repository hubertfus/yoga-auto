# s7-bug-pipe-nonobject-frame — PipeSource przepuszcza nie-obiekty i maskuje wyjątki handlerów (S2)

Status: **WDROŻONE** przez S2 (branch claude/s2-bridge-62ab59, na main od 5d0f0a0).

**Błąd 1:** `PipeSource.onData` robi `this.emit(JSON.parse(body) as IpcFromPlugin)` bez sprawdzenia kształtu. Ramki `null`, `[1,2,3]`, `42`, `{ "foo": 1 }` (bez `t`) trafiają do handlerów jako `SourceMsg`. Handler bridge'a robi `switch (m.t)` → na `null` rzuca.

**Błąd 2:** `emit` jest wewnątrz `try { … } catch { emit(log "bad frame") }`, więc **każdy** wyjątek z handlerów bridge'a (np. `raw.merge(null)` dla `tel` z `ch:null`) jest raportowany jako „bad frame” i połykany. Maskuje to prawdziwe błędy i zostawia stan częściowo zaktualizowany. Dziś to przypadkiem chroni bridge przed crashem (test „does not crash the bridge” przechodzi), ale nie jest zamierzone.

**Błąd 3 (pochodny):** ramki poprawne jako JSON, ale niezgodne ze schematem (`tel` z `ch:null`, `cfg` z `attrs:"oops"`) są dostarczane dalej.

**Repro:** `tests/pipe-source/pipe-source.test.ts`, dwa testy „[known bug] …” (fake-pipe z `garbageKinds: ["null","array","number","no-t"]` oraz `["bad-tel","bad-cfg"]`).

**Poprawka:**

```diff
-      try {
-        this.emit(JSON.parse(body) as ipc.IpcFromPlugin);
-      } catch {
-        this.emit({ t: "log", level: "warn", msg: "bad frame" });
-      }
+      let msg: unknown;
+      try {
+        msg = JSON.parse(body);
+      } catch {
+        this.emit({ t: "log", level: "warn", msg: "bad frame" });
+        continue;
+      }
+      if (!isIpcFromPlugin(msg)) {
+        this.emit({ t: "log", level: "warn", msg: "bad frame (shape)" });
+        continue;
+      }
+      this.emit(msg); // wyjątki handlerów NIE są „bad frame”
```

`isIpcFromPlugin`: obiekt, `t` ze znanego zbioru, kluczowe pola poprawnego typu (`tel.ch` obiekt, `cfg.attrs` obiekt lub null, `in.ack.seq` liczba, …). Wystarczy ręczny guard (bez Ajv w ścieżce 60 Hz). Wyjątki z handlerów logować osobno (`log error "handler threw"`).

Po poprawce zamień w obu testach `knownBug` na `it`.
