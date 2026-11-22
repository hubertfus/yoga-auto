# @yoga-auto/media

`MediaProvider` dla bridge'a: odczyt i sterowanie muzyką z PC przez Windows SMTC (Spotify, Edge/Chrome, każda aplikacja
z System Media Transport Controls). Lokalnie, bez kont i chmury.

## Jak działa
`SmtcMediaProvider` uruchamia proces potomny `bin/smtc.ps1` (Windows PowerShell 5.1 + WinRT
`GlobalSystemMediaTransportControlsSessionManager`) i rozmawia z nim JSON-lines po stdin/stdout.
Nie ma kompilacji natywnej ani zależności npm. Szczegóły i wyniki spike'a: [SPIKE.md](SPIKE.md).

- Odczyt: źródło, status, tytuł, artysta, album, pozycja, czas, flagi `canPlay/Pause/Next/Prev/Seek`, okładka.
- Sterowanie: `play`, `pause`, `toggle`, `next`, `prev`, `seek`. Gdy brak sesji SMTC, `play/pause/toggle/next/prev`
  idą jako klawisze multimedialne (VK_MEDIA_*).
- Okładki: helper przysyła obraz, provider trzyma 24 ostatnie w pamięci pod hashem (`sha1[:16]`), `artUrl = /media/art/<hash>.jpg`,
  serwuje je bridge przez `getArt` (token `?k=`).
- Wybór sesji: bieżąca sesja systemu; z `preferSpotify: true` sesja Spotify, jeśli istnieje.
- Awaria: helper pada → stan `null`, restart z backoffem (500 ms → 15 s), po 5 kolejnych porażkach provider się poddaje
  (stan `null`, komendy odrzucane), bridge działa dalej.

## Użycie
```ts
import { createMediaProvider } from "@yoga-auto/media";
const provider = createMediaProvider({ preferSpotify: true, log: (l, m) => console.log(l, m) });
// Windows: SMTC; gdy helper nie wstanie lub inny system: NullMediaProvider (start() nie rzuca)
```
`createMediaModule(provider)` z `bridge/src/modules/media.ts` robi resztę. Podpięcie w `main.ts`: `docs/proposals/s6-bridge-wiring.md`.
`MockMediaProvider` (4 utwory, okładki SVG) służy do dev/e2e: `--source mock`.

## Wymagania
Windows 10 1809+ / Windows 11, Windows PowerShell 5.1 (`powershell.exe` w PATH; jest w systemie), Node 24.

## Ograniczenia
- Polling 300 ms (PS 5.1 nie ma wygodnych zdarzeń WinRT): zmiana utworu na Yodze po ~0,3–0,5 s + opóźnienie WS.
- Przeglądarki: tytuł/artysta zależą od `mediaSession.metadata` strony; YouTube ustawia tytuł i kanał, okładka bywa pusta.
- Spotify dosyła okładkę z opóźnieniem; helper ponawia pobranie do 6 razy.
- `seek` działa tylko, gdy aplikacja zgłasza `IsPlaybackPositionEnabled` (Spotify tak, część stron nie).
- ConstrainedLanguage / AppLocker blokujące `Add-Type` → helper nie wstanie → fallback na `NullMediaProvider`.
- Przy kilku jednoczesnych sesjach (np. Spotify + YouTube) „bieżąca" to ta, którą wskaże system (ostatnio aktywna).

## Testy
`npx vitest run integrations/media`: parser JSON-lines, mapowanie `MediaState`, okładki, komendy (ack/timeout), restart,
poddanie się, fallback na Null, Mock. Helper PowerShell nie jest uruchamiany w testach (fałszywy proces potomny).
