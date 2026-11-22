# S1 spike: test input semantical (do wykonania z grą)

Status: **NIE WYKONANY** (agent nie uruchamia ETS2). Wypełnia właściciel.

## Przygotowanie
1. `cmake --build --preset release` w `plugin/`; skopiuj `plugin/build/Release/yoga_auto.dll` do `<ETS2>\bin\win_x64\plugins\`.
2. Uruchom ETS2, wejdź do kabiny (zamknij bridge). W log `yoga-auto.log` sprawdź wpis init.
3. `plugin\build\Release\pipe-dump.exe --only hello,cfg,log` → powinny pojawić się `hello` i `cfg`.

## Tabela akcji (uzupełnić: działa? / uwagi)
| akcja | komenda | działa? | uwagi |
|---|---|---|---|
| light | `pipe-dump --press light` | | |
| flasher4way | `--press flasher4way` | | |
| parkingbrake | `--press parkingbrake` | | |
| cruiectrl | `--press cruiectrl` | | |
| horn (hold) | `--hold horn 1500` | | |
| pozostałe z `actions.ts` | `--press <scs>` | | |

## Pozostałe pytania
- Minimalna liczba klatek `true` dla press (domyślnie PRESS_FRAMES=3): ____
- Convoy: plugin/input działa tak samo? Czy SDK sygnalizuje multiplayer (wpływ na `ui.pause`)? ____
- Watchdog: `pipe-dump --down horn --no-hb --seconds 6` → klakson cichnie po ~3 s? ____
- 60 min jazdy bez crasha; wyjście z gry i ponowne wejście do profilu (brak podwójnego shutdownu): ____
