# Brief S6: media i integracje Windows

## Kontekst projektu
**yoga-auto** to system w stylu CarPlay dla Euro Truck Simulator 2. Na PC z grą działa bridge (Node 24 + TS), który rozmawia z PWA na Lenovo Yoga przez WebSocket. Chcemy sterować muzyką grającą na PC (Spotify, przeglądarka, inne aplikacje zgodne z Windows SMTC) z ekranu Yogi. Wszystko lokalnie, **bez kont i chmury**.
Przeczytaj:
- `docs/ANALYSIS.md` §5.5 (porównanie opcji)
- `shared/protocol/src/media.ts`, `messages.ts` (`MediaMsg`, `MediaCmdMsg`)
- `bridge/src/modules/types.ts` (interfejs `MediaProvider` / `BridgeModule` z Fazy 0)
- `docs/DESIGN.md` (komponenty glass-ui, kafel 2×1 na Home)

## Cel
1. `@yoga-auto/media` (`integrations/media`): implementacja `MediaProvider` na Windows SMTC. Odczyt: źródło, status, tytuł, artysta, album, okładka, pozycja/czas. Sterowanie: play, pause, toggle, next, prev, seek.
2. UI odtwarzacza w PWA: kafel `media` (2×1) na Home, ekran `media`, mini-kontrolka w StatusBar (slot dostarcza S4).

## Katalogi
- **Posiadasz:** `integrations/media/**`, `apps/yoga/src/features/media/**`.
- **Nie ruszasz:** `bridge/**` (S2 wpina moduł; jeśli interfejs nie wystarcza → `docs/proposals/s6-*.md`), `shared/**`, reszta `apps/`.

## Zadania
0. **Spike S6-0:** `@coooookies/windows-smtc-monitor` (napi-rs, prebuilt, Win10 1809+). Czy daje sterowanie, czy tylko odczyt? Czy okładka jest dostępna? Opóźnienie zdarzeń? Wynik w `integrations/media/SPIKE.md`.
1. Jeśli spike się nie powiedzie: helper `yoga-media-helper.exe` (Rust + crate `windows`, `GlobalSystemMediaTransportControlsSessionManager`), protokół JSON-lines po stdin/stdout, prebuilt w `integrations/media/bin/` (build skryptem `cargo build --release`, instrukcja w README). Provider Node uruchamia helper jako proces potomny z auto-restartem.
2. Fallback sterowania: klawisze multimedialne (VK_MEDIA_PLAY_PAUSE/NEXT/PREV) przez helper albo PowerShell, gdy brak sesji SMTC.
3. Okładki: zapis do cache (hash), `artUrl` = `/media/art/<hash>.jpg` (serwowanie robi S2 przez API modułu `registerStatic`, które ma być w interfejsie z F0).
4. Wybór sesji: domyślnie bieżąca sesja systemu, opcja „preferuj Spotify”.
5. UI: kafel i ekran (okładka jako tło sheetu z blurem, duże przyciski 72 px, pasek postępu interpolowany z `positionAt`), stany „nic nie gra” i „brak modułu”.
6. `MockMediaProvider` rozbuduj o playlistę testową (dla dev i e2e).

## Definition of Done
- [ ] Na PC ze Spotify: tytuł/artysta/okładka pojawiają się na Yodze < 1 s po zmianie utworu; play/pause/next/prev działają.
- [ ] To samo dla odtwarzania w Edge/Chrome (YouTube).
- [ ] Brak sesji / zamknięcie Spotify: UI pokazuje „nic nie gra”, provider nie crashuje bridge'a.
- [ ] Testy: parser protokołu helpera, mapowanie na `MediaState`, restart helpera.
- [ ] README: instalacja, wymagania, ograniczenia.

## Jak testować bez gry
Gra nie jest potrzebna. Wystarczy bridge z `--source mock` i włączony moduł media.

## Złożoność: **M**

## Stan po Fazie 0 (od czego zaczynasz)
`integrations/media/src/index.ts`: `NullMediaProvider`, `MockMediaProvider`. Interfejs `MediaProvider` jest w `@yoga-auto/protocol` (`providers.ts`). Adapter do bridge'a (`bridge/src/modules/media.ts`, własność S2) już broadcastuje `media`, obsługuje `media` cmd i rejestruje `/media/art/`. Bridge na mocku włącza `MockMediaProvider` automatycznie. Komendy z UI: `sendMedia()` w `apps/yoga/src/core/commands.ts`, stan: `useMedia()`.
