# Spike S6-0: jak czytać i sterować SMTC

Wybrano **PowerShell 5.1 + WinRT** (`GlobalSystemMediaTransportControlsSessionManager`) jako proces potomny
(`bin/smtc.ps1`). Nie ma kompilacji natywnej, nie ma zależności npm, działa na Windows 10 1809+ / 11.

| Pytanie | Wynik |
|---|---|
| Odczyt | Tak: źródło (AUMID), status, tytuł, artysta, album, pozycja, czas, flagi `Is*Enabled`. Zmierzono na żywo (Chrome/YouTube). |
| Sterowanie | Tak: `TryPlayAsync/TryPauseAsync/TryTogglePlayPauseAsync/TrySkipNext/Previous/TryChangePlaybackPositionAsync`. Odrzucenie przez aplikację → `ack ok:false`. Nie wywoływano na prawdziwym odtwarzaczu (zakaz zadania). |
| Okładka | `MediaProperties.Thumbnail` → `DataReader` → base64. W Chrome/YouTube miniatura jest pusta; **Spotify nie był uruchomiony, więc ścieżka okładki nie była sprawdzona na żywo** (kod ponawia pobranie 6×, bo Spotify dosyła okładkę z opóźnieniem). |
| Opóźnienie | Polling 300 ms (`-PollMs`), emisja tylko przy zmianie sygnatury lub dryfie pozycji > 2 s. Zmiana utworu → UI ≤ ~0,4 s + opóźnienie WS. Start helpera do `ready`: ~0,4 s. |
| Fallback | Gdy brak sesji SMTC: klawisze multimedialne (`keybd_event`, VK 0xB3/0xB0/0xB1). |
| Odrzucone | `@coooookies/windows-smtc-monitor` (napi-rs): zbędna zależność z prebuilt binarką, a PowerShell daje to samo, w tym sterowanie. |
| Ograniczenia | PowerShell 5.1 nie ma zdarzeń WinRT wygodnych do użycia → polling. Wymagany `Add-Type` (ConstrainedLanguage mode, np. AppLocker, zablokuje helper → provider spada na `NullMediaProvider`). Przeglądarki: sesja „Chrome"/„Edge" bez okładki, gdy strona nie ustawia `mediaSession.metadata.artwork`. |
