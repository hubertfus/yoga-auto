Status: **WDROŻONE** przez lead (2026-11-22)

# S6 → S2: podpięcie SMTC w bridge (`bridge/src/main.ts`)

Dziś bridge włącza media tylko dla mocka (`--mock-media` albo `--source mock`). Na prawdziwej grze (pipe) i na Windows powinien
włączyć `AutoMediaProvider` z `@yoga-auto/media`: SMTC, a gdy helper nie wstanie (brak PowerShella/WinRT, inny system) cichy fallback
na `NullMediaProvider`. `start()` nigdy nie rzuca, więc bridge się nie wywróci; UI pokazuje „Nic nie gra".

Nowa opcja `--media auto|mock|null|off` (domyślnie: `mock` dla `--source mock`, inaczej `auto`) oraz `--prefer-spotify`.
`--mock-media` zostaje jako alias `--media mock`.

```diff
--- a/bridge/src/main.ts
+++ b/bridge/src/main.ts
@@
-import { MockMediaProvider } from "@yoga-auto/media";
+import { createMediaProvider } from "@yoga-auto/media";
@@
     "mock-media": { type: "boolean", default: false },
+    media: { type: "string" }, // auto | mock | null | off
+    "prefer-spotify": { type: "boolean", default: false },
@@
-const modules =
-  values["mock-media"] || settings.source === "mock" ? [createMediaModule(new MockMediaProvider())] : [];
+const mediaMode = values.media ?? (values["mock-media"] || settings.source === "mock" ? "mock" : "auto");
+const modules =
+  mediaMode === "off"
+    ? []
+    : [
+        createMediaModule(
+          createMediaProvider({
+            ...(mediaMode === "auto" ? {} : { force: mediaMode as "mock" | "null" }),
+            preferSpotify: values["prefer-spotify"],
+            log: (l, m) => console.log(`[${l}] ${m}`),
+          }),
+        ),
+      ];
```

Uwagi:
- `createMediaModule` już rejestruje `/media/art/` przez `provider.getArt` (Auto/Smtc/Mock je mają); hash okładki = `sha1[:16]`, jak `artHash`.
- Mime okładki z SMTC bywa `image/png`; adapter zwraca mime z providera, a ścieżka `.jpg` jest tylko kluczem, więc nic nie trzeba zmieniać.
- Okładka mocka to SVG (`image/svg+xml`) — działa w `<img>`.
- Test integracyjny po stronie S2 (opcjonalnie): `createMediaModule(new MockMediaProvider())` → `GET /media/art/mock0.jpg?k=…` zwraca 200 `image/svg+xml`.
- Opcja `--prefer-spotify` wybiera sesję Spotify, gdy jest (w przeciwnym razie bieżąca sesja systemu).
