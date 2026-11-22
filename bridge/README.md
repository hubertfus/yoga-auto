# bridge: serwer yoga-auto (Node 24 + TypeScript)

Proces na PC z grą: czyta telemetrię (plugin DLL przez named pipe, mock albo nagranie), liczy stan/alerty/trip,
rozsyła go po WebSocket do PWA na Yodze i realizuje komendy (`press/hold/set`) w pętli zamkniętej.
Kontrakt: [`docs/PROTOCOL.md`](../docs/PROTOCOL.md), typy: `shared/protocol`.

## Uruchomienie

```powershell
npm install                                   # raz, w korzeniu repo
npm run dev -w bridge                          # mock + bez parowania (dev)
node bridge/src/main.ts --source pipe          # prawdziwa gra (plugin S1), z parowaniem
node bridge/src/main.ts --source mock --scenario city-night --no-auth
```

Domyślny port: **7420** (`--port`, `config.json`). PWA serwowane z `apps/yoga/dist` (`--static <dir>`).

### Flagi

| Flaga | Znaczenie |
|---|---|
| `--source mock\|pipe\|replay` albo `replay:<plik.yarec>` | źródło telemetrii (domyślnie `pipe`) |
| `--scenario highway\|…` | scenariusz mocka |
| `--replay <plik.yarec>` `--speed <x>` `--loop` | odtwarzanie nagrania (wymaga pakietu `@yoga-auto/recorder` z `tools/recorder`) |
| `--record <plik.yarec>` | nagrywanie sesji (jw.); plik jest zamykany przy wyjściu bridge'a |
| `--port`, `--host`, `--fast-hz 15\|30\|60` | sieć i częstotliwość `fast` |
| `--no-auth` | bez tokenu i parowania (tylko dev w LAN) |
| `--no-mdns` | bez ogłaszania `_yoga-auto._tcp` |
| `--mock-media` | mock odtwarzacza mediów (domyślnie włączony dla `--source mock`) |

### config.json

`%APPDATA%\yoga-auto\config.json` (katalog danych; nadpisanie: zmienna `YOGA_AUTO_DATA_DIR`). Wszystkie pola opcjonalne,
flagi CLI mają pierwszeństwo, błędne pola są pomijane z ostrzeżeniem w konsoli.

```json
{ "port": 7420, "host": "0.0.0.0", "fastHz": 30, "source": "pipe", "inputEnabled": true }
```

`inputEnabled: false` wyłącza komendy: `hello.capabilities.input = false`, każde `cmd` dostaje `input_disabled`.

Pozostałe pliki w tym katalogu: `devices.json` (sparowane urządzenia: tylko skrót SHA-256 tokenu), `trips.jsonl` (komputer pokładowy).

## Parowanie

1. Na Yodze otwórz `http://<adres-PC>:7420` (adres wypisuje konsola; `_yoga-auto._tcp` w mDNS).
2. Aplikacja woła `POST /api/pair/start`: bridge **pokazuje 6-cyfrowy PIN tylko w konsoli PC** (ważny 120 s, 5 prób).
3. Wpisz PIN dotykiem (`/api/pair/confirm`), aplikacja dostaje token i używa go w subprotokole WS (`token.<…>`).
4. Restart bridge'a nie wymaga ponownego parowania (token żyje w `devices.json`).

Zarządzanie urządzeniami (osobny proces, działający bridge rozłącza odwołane urządzenie w ≤ 2 s):

```powershell
node bridge/src/main.ts devices list
node bridge/src/main.ts devices revoke <id|nazwa>
node bridge/src/main.ts devices revoke --all
```

## Zapora (Windows)

Pozwól na ruch przychodzący tylko w sieci **Prywatnej** (nie Publicznej/Domenowej), na jednym porcie TCP:

```powershell
New-NetFirewallRule -DisplayName "yoga-auto bridge" -Direction Inbound -Protocol TCP -LocalPort 7420 -Profile Private -Action Allow
```

mDNS wymaga UDP 5353 (wbudowana reguła „mDNS” zwykle wystarcza). Bridge dodatkowo sam odrzuca połączenia spoza adresów
prywatnych, z nagłówkiem `Host` spoza LAN (DNS rebinding) i z obcym `Origin`.

## Zachowanie

- `fast` (do 60 Hz) wychodzi od razu po ramce `tel`, per klient (własne `fastHz`, `seq`, progi zmian); `slow` 2 Hz; `snapshot` co 10 s;
  backpressure: przy zapchanym gnieździe `fast` jest pomijany, następna delta jest pełna.
- Złe ramki (`null`, nie-obiekty, niezgodne ze schematem) z WS i z pipe są ignorowane/logowane, wyjątki handlerów nie ubijają procesu
  (`unhandledRejection` jest tylko logowane).
- `hello.ipc` ≠ `IPC_VERSION` → log błędu, `connected:false`, dalsze `tel/cfg/evt` ignorowane do poprawnego `hello`.
- Rozłączenie ostatniego klienta z trzymanym wejściem → `up` + `releaseAll` do pluginu; watchdog `keep` dla `hold`.
- Latencja ramka `tel` → `ws.send` jest logowana co 10 s na poziomie debug (`p50/p95/p99`); cel p95 < 2 ms.

## Testy

```powershell
npm run check            # gen + typecheck + vitest (całe repo)
npx vitest run bridge    # tylko bridge
```

Testy używają `port: 0` i symulowanego źródła (`bridge/test/simsource.ts`) albo named pipe z lokalnym serwerem testowym.
