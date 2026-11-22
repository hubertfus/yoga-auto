# yoga_auto.dll — plugin ETS2 (S1)

Plugin SCS SDK (telemetria 1.16 + input semantical/generic) hostujący pipe `\.\pipe\yoga-auto` (IPC v1, `docs/PROTOCOL.md` §5).

## Build
Wymagane: VS Build Tools 2026 (generator „Visual Studio 18 2026”), CMake. Najpierw `npm run gen` w korzeniu repo (generuje `plugin/generated/*.gen.h`).
```powershell
cd plugin
cmake --preset vs
cmake --build --preset release     # → build/Release/{yoga_auto.dll,pipe-dump.exe,yoga_tests.exe}
build\Release\yoga_tests.exe       # testy jednostkowe (doctest)
```
`/W4 /WX` — build bez ostrzeżeń. cmake bywa poza PATH: `...\BuildTools\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin`.

## Instalacja
Skopiuj `build/Release/yoga_auto.dll` do `<ETS2>\bin\win_x64\plugins\` (utwórz katalog `plugins`). Log: `%USERPROFILE%\Documents\Euro Truck Simulator 2\yoga-auto.log`.

## Konfiguracja / wyłączanie inputu
`Documents\Euro Truck Simulator 2\yoga-auto.ini`:
```
inputEnabled=0      ; twarda blokada inputu (np. TruckersMP) — plugin nie rejestruje urządzeń
telMinIntervalMs=8  ; minimalny odstęp ramek tel (0 = każda klatka)
```
Wyłączenie w locie: komenda IPC `{"t":"opts","inputEnabled":false}`.

## Diagnostyka
`pipe-dump.exe` (zamknij bridge — pipe obsługuje 1 klienta): `--only hello,cfg`, `--press light`, `--hold horn 1500`, `--no-hb` (test watchdoga 3 s). Pełna lista w nagłówku `tools/pipe-dump.cpp`.

## Architektura
`src/core/` — logika bez SDK/WinAPI (snapshot seqlock, JSON, ramki, sesja, kolejka SPSC, urządzenie inputu z press/down/up, watchdog 3000 ms). `src/plugin.cpp` — glue SDK, `src/pipe_server.cpp` — wątek IO (overlapped, ACL: bieżący użytkownik, `PIPE_REJECT_REMOTE_CLIENTS`). Callbacki gry tylko zapisują wartości — zero alokacji/IO.

## Znane ograniczenia
- Brak UI bindowania: wejścia semantical działają wg `controls.sii` (nazwy `semantical.<mix>`).
- Jeden klient pipe naraz.
- Test z grą oraz spike S1-0 nie wykonane (nie ma gry w środowisku agenta): `docs/proposals/s1-semantical-test.md`.
- Windows Smart App Control może blokować niepodpisane `yoga_tests.exe`/`pipe-dump.exe`/DLL.
