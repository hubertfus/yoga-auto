# Brief S7: QA i tooling

## Kontekst projektu
**yoga-auto** to system w stylu CarPlay dla Euro Truck Simulator 2: plugin DLL w grze → named pipe → bridge (Node) → WebSocket → PWA na Lenovo Yoga. Strumienie pracują równolegle i **bez odpalonej gry**, więc narzędzia symulacji i testy kontraktu są warunkiem pracy reszty zespołu.
Przeczytaj:
- `docs/PROTOCOL.md` (cały), `shared/protocol/src/*`, `shared/protocol/fixtures/*`, `shared/protocol/schema/*` (z F0)
- `docs/PLAN.md` §6 (kryteria kamieni milowych), §7 (integracja)
- `tools/mock` (z Fazy 0, od teraz Twój)

## Cel
Narzędzia: recorder/replayer sesji, fake-pipe (udawany plugin), rozwój mocka, testy kontraktu, e2e i benchmark fps.

## Katalogi
- **Posiadasz:** `tools/**` (bez `tools/map`), `tests/**` (testy przekrojowe i kontraktu), `e2e/**`.
- **Nie ruszasz:** kodu produkcyjnego innych strumieni. Znalezione błędy zgłaszasz jako plik `docs/proposals/s7-bug-<temat>.md` albo jako test, który failuje (oznaczony `.fails`/skip z linkiem do zgłoszenia).

## Zadania
1. **Recorder** (`tools/recorder`): implementacja interfejsu `Recorder` z bridge'a. Zapis `.yarec` = gzip JSONL `{ts, kind:"ipc"|"ws", msg}`. Nagrywa wejście IPC (do replay pipe) i wyjście WS. CLI `yarec info|cut|speed`.
2. **ReplaySource**: odtwarzanie `.yarec` w bridge'u (x0.5–x8, pętla, pauza). Plus 3 przykładowe nagrania syntetyczne z mocka w `tools/recorder/samples/`. Prawdziwe nagrania z gry dograsz w sesji integracyjnej.
3. **Fake-pipe** (`tools/fake-pipe`): serwer `\\.\pipe\yoga-auto` mówiący IPC v1 jak plugin (hello, cfg, tel ze scenariusza albo replay), przyjmuje `in`, symuluje efekt i `in.ack`, watchdog `hb`. Tryby awarii: zrywanie połączenia, śmieciowe ramki, ramka > limit, brak hb.
4. **Mock** (`tools/mock`): dopracowanie scenariuszy, deterministyczny seed, reakcja na wszystkie akcje z `ACTIONS`.
5. **Testy kontraktu** (`tests/contract`): każdy fixture waliduje się względem JSON Schema. Bridge na mocku przez 30 s produkuje wyłącznie wiadomości zgodne ze schematem. Ten sam zestaw fixture'ów IPC jest używany w testach C++ S1 (dostarcz runner/instrukcję).
6. **E2E** (`e2e/`, Playwright + Edge/Chromium): parowanie, nawigacja, tapnięcie akcji → `cmd` w bridge'u → stan w UI, reconnect po kill bridge'a, alert → toast.
7. **Benchmark fps** (`tools/bench`): Playwright + CDP tracing na ekranach Home/Drive/Vehicle w każdym tierze przy 30 i 60 Hz. Raport JSON + HTML (p50/p95/p99, dropped frames). Tryb ręczny na Yodze `?bench=1` z wynikiem do skopiowania.
8. **Pomiar latencji end-to-end:** znaczniki `frame`/`ts` + offset zegara z ping. Raport p50/p95 gra → UI.
9. Root skrypty (propozycja dla leada): `npm run dev:mock`, `npm run dev:replay -- <plik>`, `npm run e2e`, `npm run bench`.

## Test z grą (checklista sesji integracyjnej, wykonuje człowiek + lead)
- [ ] DLL w `plugins/`, gra startuje, log `yoga-auto.log` z wersją API.
- [ ] Bridge `--source pipe --record`: `status.connected`, kanały z `hello`.
- [ ] Jazda 10 min: zegary zgodne z HUD gry (prędkość ±1 km/h, bieg, paliwo).
- [ ] Zlecenie: start → widget job, dostarczenie → toast `job.delivered`.
- [ ] Każda akcja z panelu pojazdu (lista z `ACTIONS`), wynik zapisany w tabeli.
- [ ] Zerwanie Wi-Fi z wciśniętym klaksonem → zwolnienie ≤ 3 s.
- [ ] Nagranie `.yarec` zapisane do `tools/recorder/samples/real-*.yarec`.

## Definition of Done
- [ ] `npm run check` uruchamia testy kontraktu. `npm run e2e` zielone na mocku w CI (headless Chromium).
- [ ] Fake-pipe pozwala S2 przetestować `PipeSource` bez gry. Wszystkie tryby awarii są pokryte testami bridge'a (we współpracy z S2).
- [ ] Raport benchmarku generuje się jednym poleceniem.
- [ ] README każdego narzędzia.

## Złożoność: **M**

## Stan po Fazie 0 (od czego zaczynasz)
`tools/mock` (MockSource, 5 scenariuszy, reaguje na wejścia) — teraz Twój. Interfejs `TelemetrySource` jest w `@yoga-auto/protocol` (`providers.ts`). Testy kontraktu: `shared/protocol/test/contract.test.ts` (fixture'y vs JSON Schema z `npm run gen`). Smoke e2e bez przeglądarki: `scripts/smoke.ts` (własność leada; możesz zaproponować przeniesienie do `tests/`). Recorder: bridge nie ma jeszcze hooka — zdefiniuj interfejs `Recorder` w `tools/recorder` i zgłoś S2 przez `docs/proposals/s7-recorder-hook.md`.
