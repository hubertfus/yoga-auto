# Brief S1: plugin gry (C++, SCS SDK)

## Kontekst projektu
**yoga-auto** to system w stylu CarPlay dla Euro Truck Simulator 2. Gra działa na PC z Windowsem. Obok kierownicy stoi Lenovo Yoga z ekranem dotykowym i pokazuje dane z gry na żywo oraz steruje grą dotykiem. Łańcuch: **plugin DLL w grze** → named pipe → **bridge (Node)** na PC → WebSocket w LAN → **PWA na Yodze**.
Ty piszesz plugin. Przeczytaj najpierw:
- `docs/ARCHITECTURE.md` (ADR-001, 002, 003)
- `docs/PROTOCOL.md` §5 (IPC). **To Twój kontrakt.**
- `shared/protocol/src/ipc.ts` (wiadomości + `PLUGIN_CHANNELS`), `shared/protocol/src/actions.ts` (lista wejść)
- `docs/ANALYSIS.md` §1, §2

## Cel
`yoga_auto.dll` (x64) ładowany z `<ETS2>\bin\win_x64\plugins\`:
1. rejestruje kanały z `PLUGIN_CHANNELS`, eventy `frame_start/frame_end/paused/started/configuration/gameplay`;
2. rejestruje **urządzenie input semantical** z wejściami (`scs` z `ACTIONS`, `device:"semantical"`) oraz **urządzenie generic** „yoga-auto” z wejściami `device:"generic"`;
3. hostuje pipe `\\.\pipe\yoga-auto` i mówi protokołem IPC v1.

## Katalogi
- **Posiadasz:** `plugin/**` (CMakeLists, `src/`, `tests/`, `README.md`).
- **Nie ruszasz:** `plugin/generated/**` (generuje lead z `shared/protocol`), `shared/**`, cokolwiek poza `plugin/`.
- Potrzebujesz zmiany kontraktu (np. inna nazwa kanału)? Napisz `docs/proposals/s1-<temat>.md` i pracuj dalej na lokalnym obejściu.

## Zadania
0. **Spike S1-0 (dzień 1, PRIORYTET).** Nazwy kontrolek są już sprawdzone: wszystkie `scs` z `actions.ts` występują jako `semantical.<mix>` w `controls.sii` ETS2 1.62, a nagłówek SDK potwierdza „No binding UI”. Na podstawie `plugin/third_party/scs_sdk_1_16/examples/input_semantical` sprawdź **w grze**:
   - czy każda akcja z `actions.ts` faktycznie działa (tabela akcja → działa? → uwagi);
   - minimalną liczbę klatek `true` dla „press” (domyślnie `PRESS_FRAMES=3`);
   - czy w trybie **Convoy** (wbudowany MP) plugin i input działają tak samo i czy SDK sygnalizuje sesję multiplayer (wpływ na `ui.pause`).
   Wynik zapisz w `docs/proposals/s1-semantical-test.md`. Referencja (GPL-3.0, **nie kopiuj kodu**): https://github.com/ETS2LA/scs-sdk-controller.
1. Szkielet z F0 rozbuduj o rejestrację kanałów (z `plugin/generated/channels.gen.h`), z tolerancją na brak kanału.
2. Snapshot stanu: struktura POD + **seqlock / double buffer**. Callbacki wątku gry tylko zapisują wartości i flagi „dirty”. Zero alokacji, zero locków blokujących, zero IO.
3. Wątek IO: `CreateNamedPipeW` (ACL: bieżący użytkownik, `PIPE_REJECT_REMOTE_CLIENTS`), overlapped IO, ramki `uint32 LE + JSON`. Serializacja JSON w wątku IO (np. własny lekki writer albo `nlohmann/json` przez FetchContent).
4. Config events → `cfg` (przechowuj ostatnie, wysyłaj wszystkie po `hello`). Gameplay events → `evt`.
5. Input: kolejka SPSC IO → gra; `input_event_callback` przy `first_in_frame` pobiera komendy; press/down/up wg PROTOCOL.md §5; `in.ack` po wydaniu wartości; watchdog 3000 ms bez `hb` → zwolnij wszystko; `first_after_activation` → reset cache.
6. `opts`: `inputEnabled` (wyłącznik, np. dla TruckersMP), `telMinIntervalMs`.
7. Log: `%USERPROFILE%\Documents\Euro Truck Simulator 2\yoga-auto.log` + `t:"log"`.
8. Shutdown idempotentny (ostrzeżenie: RenCloud issue #128, podwójny `scs_telemetry_shutdown`).

## Definition of Done
- [ ] DLL buduje się `cmake --preset release` (VS Build Tools 2026, generator „Visual Studio 18 2026”, x64), bez ostrzeżeń `/W4`.
- [ ] Testy jednostkowe (doctest): serializacja ramek zgodna z `shared/protocol/fixtures/ipc/*.json`, logika press/hold/watchdog na symulowanych klatkach.
- [ ] `plugin/tools/pipe-dump.exe` (albo skrypt Node w `plugin/tools/`) łączy się z pipe i wypisuje ramki: ręczny test z grą pokazuje `hello`, `cfg`, `tel` przy jeździe.
- [ ] W grze: `light`, `flasher4way`, `parkingbrake`, `cruiectrl`, `horn` (hold) działają z `pipe-dump --send`.
- [ ] Gra 60 min bez crasha. Wyjście z gry i ponowne wejście do profilu bez wycieków ani podwójnych shutdownów.
- [ ] `plugin/README.md`: build, instalacja, wyłączanie inputu, znane ograniczenia, wynik spike'a.

## Jak testować bez gry
Wydziel logikę (snapshot, serializacja, kolejka inputu, watchdog) od SDK za interfejsami i testuj na sztucznych klatkach. Bridge (S2) i fake-pipe (S7) testują drugą stronę bez Twojego DLL.

## Złożoność: **L**

## Stan po Fazie 0 (od czego zaczynasz)
`plugin/` buduje się (`cmake --preset vs` + `cmake --build --preset release`) do `build/Release/yoga_auto.dll`: telemetry init loguje grę/wersję do `Documents\Euro Truck Simulator 2\yoga-auto.log`. SDK 1.16 (MIT) jest w `plugin/third_party/`. Nagłówki `plugin/generated/{actions,channels}.gen.h` generuje `npm run gen` z kontraktu — nie edytuj ich ręcznie. Przykład `examples/input_semantical` pokazuje rejestrację urządzenia. Druga strona IPC (bridge `PipeSource`) już istnieje: `node bridge/src/main.ts --source pipe --no-auth`.
Test z grą wymaga właściciela — gdy dojdziesz do momentu „trzeba odpalić ETS2”, zatrzymaj się i napisz dokładnie, co ma zrobić (skopiować DLL do `<ETS2>\bin\win_x64\plugins\`, co sprawdzić).
