# mock — symulator gry (S7)

`MockSource` implementuje `TelemetrySource` (`@yoga-auto/protocol`) bez gry: emituje `hello`, `cfg`, pełny `tel`
(w pierwszym `tel` także kanały `trailer.0..9`), potem delty; reaguje na `in` (wszystkie akcje z `ACTIONS`) i odsyła
`in.ack`; hold ma watchdog `hb`.

## Scenariusze

`highway` · `city-night` · `low-fuel` · `crash` · `job-cycle` (zlecenie → `job.delivered` po ~60 s czasu symulacji).

## Opcje (`createMockSource({...})`)

| Opcja | Znaczenie |
|---|---|
| `scenario` | jeden z powyższych |
| `fps` | częstotliwość „klatek gry” (domyślnie 60) |
| `speed` | przyspieszenie czasu symulacji (np. 6 w teście job-cycle) |
| `seed` | deterministyczny seed (generator LCG) |
| `manual` | bez timera; czas posuwa `advance(dtSeconds)` — próbki i testy deterministyczne |

Uwaga: w trybie z timerem czas symulacji to liczba ticków × dt, nie czas ścienny — na Windows `setInterval` bywa
wolniejszy niż 60 Hz, więc testy nie powinny zakładać dokładnych czasów ściennych.

## Uruchomienie

```powershell
node bridge/src/main.ts --source mock --scenario highway --no-auth     # = npm run dev:bridge
```
