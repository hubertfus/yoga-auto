# Testy kontraktu (S7)

| Plik | Co sprawdza |
|---|---|
| `fixtures.test.ts` | każdy fixture z `shared/protocol/fixtures` waliduje się względem JSON Schema (`npm run gen`) |
| `bridge-mock.test.ts` | bridge na mocku przez 30 s (po jednym na scenariusz): każda wiadomość WS i IPC zgodna ze schematem, sekwencje, ack, odporność na śmieci. Skrócenie: `CONTRACT_SECONDS=8 npx vitest run tests/contract/bridge-mock` |
| `ipc-frames.test.ts` | złote ramki `frames/*.bin` są aktualne względem fixture'ów |

## Instrukcja dla C++ (S1): złote ramki IPC

`frames/` zawiera bajty dokładnie takie, jakie płyną w pipe (`uint32 LE długość` + UTF-8 JSON), oraz
`frames/manifest.json`. Wygenerowane przez `node tests/contract/ipc-frames.ts` (nie edytuj ręcznie).

Runner w C++ powinien dla każdego `cases[]`:

1. wczytać plik `file` i podać go parserowi ramek **jako strumień** — całością oraz pocięty na kawałki 1, 3 i 7 bajtów;
2. porównać wynik z `expect`:

| `expect` | Oczekiwane zachowanie parsera |
|---|---|
| `messages` | zwraca kolejno wiadomości o `t` z pola `t` (np. `["hello","in","tel"]`) |
| `bad_json` | ramka jest pomijana (zły JSON / nie obiekt / brak `t`), połączenie żyje; przy `events` kolejność `message`/`bad_json` musi się zgadzać (np. `mixed-good-bad-good.bin`) |
| `too_large` | długość w nagłówku > `maxFrameBytes` (262144): zerwij połączenie, nie czekaj na payload (też `0xFFFFFFFF`) |
| `incomplete` | zbyt mało bajtów (`incomplete-header`, `incomplete-body`): brak wiadomości, brak crasha, parser czeka na resztę |

3. `valid-max-size.bin` (payload dokładnie 262144 B) MUSI przejść; `valid-unicode.bin` sprawdza długość w **bajtach** UTF-8.

Dodatkowo plugin wysyłający ramki można sprawdzić na żywo (bez bridge'a): `node tools/fake-pipe/src/probe.ts`
(patrz `tools/fake-pipe/README.md`), a po stronie odbiorczej — uruchomić `fake-pipe` i podłączyć DLL/klienta testowego.
