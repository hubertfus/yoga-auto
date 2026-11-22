# fake-pipe — udawany plugin gry (S7)

Serwer named pipe `\.\pipe\yoga-auto` mówiący IPC v1 tak jak DLL z S1: `hello`, `cfg`, `tel` (ze scenariusza mocka
albo z nagrania `.yarec`), przyjmuje `in` i odpowiada `in.ack`, pilnuje watchdoga `hb`. Pozwala testować `PipeSource`
(bridge) bez gry. Ramki: `uint32 LE długość` + UTF-8 JSON (limit `IPC_MAX_FRAME_BYTES`).

## Uruchomienie

```powershell
node tools/fake-pipe/src/cli.ts --scenario city-night
node tools/fake-pipe/src/cli.ts --replay tools/recorder/samples/highway-60s.yarec --speed 2 --loop
node tools/fake-pipe/src/cli.ts --faults drop:5000,garbage:0.02,stall:8000/4000 -v
# w drugim terminalu:
node bridge/src/main.ts --source pipe --no-auth
```

Opcje: `--path P` (domyślnie `\.\pipe\yoga-auto`; w testach używaj unikalnej, np. `\.\pipe\yoga-auto-s7-<pid>`),
`--scenario`, `--replay F --speed X --loop`, `--seed N`, `--fps N`, `-v`.

## Tryby awarii (`--faults a,b:arg,…`)

| Skrót | Efekt |
|---|---|
| `drop:MS` / `drop-frames:N` | zrywa połączenie co MS / po N ramkach `tel` |
| `garbage:P` (+ `garbage-kinds:a+b`) | przed ramką `tel` wstrzykuje śmieci z prawdop. P (not-json, invalid-utf8, empty, null, array, number, no-t, unknown-t, bad-tel, bad-cfg) |
| `oversize:MS` | po MS ramka z długością > limit |
| `fragment:N` | zapisy dzielone na kawałki ≤ N B |
| `stall:AFTER/LEN` | po AFTER ms przestaje słać `tel` na LEN ms |
| `ack-delay:MS`, `drop-acks`, `ack-fail` | opóźnia / gubi / odrzuca `in.ack` |
| `ipc:N` | `hello.ipc` = N (niezgodna wersja) |
| `no-hello` | pomija `hello` |
| `input-disabled` | tylko telemetria, brak reakcji na `in` |

## API w testach

```ts
import { FakePipeServer, PipeTestClient, parseFaults } from "@yoga-auto/fake-pipe";
```

`FakePipeServer` (start/stop, opcje `path`, `source`, `faults`), `PipeTestClient` (klient pipe: `connect`, `send`,
zdarzenia `msg`), `encodeFrame`/`FrameDecoder` (framing). Przykłady: `tests/pipe-source/`, `src/fake-pipe.test.ts`.

## probe — sprawdzenie PRAWDZIWEGO pluginu

```powershell
node tools/fake-pipe/src/probe.ts [--path P] [--seconds 10] [--press light] [--json]
```

Łączy się z pipe, wysyła `hb`, waliduje każdą ramkę względem `ipc-from-plugin.schema.json` i kontroluje handshake
(hello → cfg → pełny tel). Kod wyjścia: 0 zgodny, 1 naruszenia, 2 brak połączenia. Zweryfikowane na fake-pipe
(`OK: plugin conforms to IPC v1`).
