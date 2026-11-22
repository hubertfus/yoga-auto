# Propozycja S7 → lead: braki w fixture'ach `shared/protocol/fixtures`

Testy kontraktu (`tests/contract/fixtures.test.ts`) walidują tylko to, co jest w katalogu fixture'ów. Brakuje
przykładów dla następujących typów wiadomości, więc schematy dla nich nie są pokryte przykładem
(bridge-mock pokrywa część dynamicznie, ale nie błędne przypadki):

- **WS bridge → UI:** `config`, `media`, `pong`, `snapshot`, `status`, `log`
- **WS UI → bridge:** `ping`, `resync`, `subscribe`, `trip.reset`
- **IPC plugin → bridge:** `cfg`, `evt`, `in.ack`, `input.active`, `log`, `hb`
- **Inne:** `opts`, `releaseAll`

Rekomendacja: po jednym poprawnym fixture na typ + 2–3 negatywne (np. `tel` z `ch:null`, `cmd` bez `id`) w
`shared/protocol/fixtures/invalid/` z oczekiwanym błędem. Gdy fixture'y pojawią się w `ipc/`, `npm run gen`-owane złote
ramki (`node tests/contract/ipc-frames.ts`) uzupełnią się same, a runner C++ dostanie je w `manifest.json`.
