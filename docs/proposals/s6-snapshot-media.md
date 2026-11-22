# S6 → S2/S4: keyframe `snapshot` zeruje `media` w kliencie

**Objaw.** Przy `--source mock` UI mediów pokazuje utwór tylko do najbliższego keyframe'u, potem „Nic nie gra" (do ponownego
połączenia). Na żywo: po `navigate` na ekran `media` i kliknięciu „następny" `store.state.media === null`.

**Przyczyna.** `bridge/src/server.ts:308` rozsyła `snapshot` co `KEYFRAME_INTERVAL_MS` do wszystkich klientów, a `store.state.media`
w bridge'u jest zawsze `null` (stan mediów żyje w providerze, nie w store'ze). Klient w `apps/yoga/src/core/store.ts`
(`case "snapshot": this.state = msg.state`) podmienia cały stan, więc kasuje `media` odebrane wcześniej osobną wiadomością `media`.
(`media` jest w `FullState`, więc to nie błąd protokołu, tylko brak wypełnienia pola w snapshocie.)

**Obejście S6** (już w `apps/yoga/src/features/media/hooks.ts`): feature trzyma własną kopię ostatniego `media`
(`client.onMessage`), czyszczoną tylko przy nowej sesji bridge'a. Działa niezależnie od poprawki poniżej.

**Poprawka docelowa (wystarczy jedna z dwóch):**

1. S4, jednolinijkowa — klient nie nadpisuje `media` snapshotem:
```diff
--- a/apps/yoga/src/core/store.ts
+++ b/apps/yoga/src/core/store.ts
       case "snapshot":
-        this.state = msg.state;
+        // `media` płynie własną wiadomością; snapshot z bridge'a ma je puste
+        this.state = { ...msg.state, media: msg.state.media ?? this.state.media };
```
2. S2 — bridge wypełnia `media` w snapshocie: `BridgeContext` powinien dać modułowi `setSnapshotField("media", state)` albo
   `server.ts` trzyma `store.state.media`, aktualizowane z `provider.onChange` (np. przez `ctx.setMedia(state)`).
   Czystsze, ale zmienia kontrakt `BridgeContext`.

Po wdrożeniu 1 lub 2 `useMediaInfo` można uprościć do `useMedia()` ze store'u (S6 to zrobi po merge'u).
