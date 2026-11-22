# Brief S2: bridge / serwer (Node 24 + TypeScript)

## Kontekst projektu
**yoga-auto** to system w stylu CarPlay dla Euro Truck Simulator 2. Gra działa na PC, a laptop Lenovo Yoga z dotykiem stoi obok kierownicy jako ekran w kabinie. Łańcuch: plugin DLL w grze → named pipe → **bridge (Ty)** → WebSocket w LAN → PWA na Yodze. Bez chmury, bez kont.
Przeczytaj:
- `docs/ARCHITECTURE.md` (komponenty, przepływy, ADR-003..005, 009)
- `docs/PROTOCOL.md` (cały). **To Twój kontrakt w obie strony.**
- `shared/protocol/src/*` (typy), `shared/protocol/fixtures/*`
- `docs/ANALYSIS.md` §3, §5.3 (alerty), §5.4 (trip)

## Cel
Proces `bridge` na PC, który:
- czyta telemetrię z `TelemetrySource` (`PipeSource` = plugin, `MockSource` z `tools/mock`, `ReplaySource` z `tools/recorder`);
- tłumaczy surowe kanały SDK na `FastState`/`SlowState`/`ConfigState` (`src/mapping.ts`);
- wysyła `fast` (30/60 Hz), `slow` (2 Hz), `config`, `status`, `event`, `alerts`, `media`, `snapshot` (keyframe 10 s) z throttlingiem, progami i backpressure (PROTOCOL.md §3);
- przyjmuje `cmd` i realizuje `press/hold/set` (pętla zamknięta, PROTOCOL.md §4) przez `CommandSink`;
- serwuje PWA (`apps/yoga/dist`), `/api/*` (parowanie PIN, info), okładki, a w M4 kafle;
- ogłasza się przez mDNS (`_yoga-auto._tcp`, port 7420);
- hostuje moduły (`BridgeModule`), np. media z `integrations/media`.

## Katalogi
- **Posiadasz:** `bridge/**`.
- **Nie ruszasz:** `shared/protocol` (propozycje → `docs/proposals/s2-*.md`), `tools/**` (S7), `integrations/**` (S6), `apps/**`.

## Zadania
1. `PipeSource`: klient `net.connect(PIPE_NAME)`, parser ramek, retry co 1 s, `hb` co 250 ms, `releaseAll` przy rozłączeniu ostatniego klienta WS z aktywnym hold.
2. `mapping.ts`: tabela kanał SDK → ścieżka stanu + konwersje (np. `truck.light.aux.front` u32 → `"off"|"dimmed"|"full"`, `rest.stop` → `restStopMin`, `blinker` z dźwigni). Config SDK (atrybuty `job`, `truck`, `trailer.N`) → `ConfigState`. `job.started` wyliczany przy pojawieniu się configu `job`, `trailer.attached/detached` z `trailer.N.connected`.
3. `StateStore` + `Throttler` (osobne zegary fast/slow, progi, płytkie delty grup, wspólny `seq`).
4. WS (`ws`): subprotokół + token, origin check, filtr adresów prywatnych, rate limit 20 cmd/s, `ping/pong`, `subscribe`, `resync`, kody zamknięcia z `version.ts`.
5. `CommandRouter`: walidacja z `ACTIONS`, `game_paused`/`input_disabled`/`not_supported`, set-state dla `lights.mode`, `retarder.level`, `wipers.level`, ack z `tookMs`, hold watchdog (`keep`), zwalnianie przy rozłączeniu.
6. `AlertEngine` (reguły z ANALYSIS §5.3, histereza, `sticky`) i `TripComputer` (persist `%APPDATA%\yoga-auto\trips.jsonl`).
7. Parowanie: `/api/pair/start` (PIN w konsoli + QR w terminalu), `/api/pair/confirm`, `devices.json`, odwołanie urządzenia z CLI (`bridge devices revoke <id>`).
8. mDNS (`bonjour-service`), HTTP statyczny z cache headers + `Range`.
9. Konfiguracja `%APPDATA%\yoga-auto\config.json` (port, fastHz, źródło, inputEnabled) + CLI `--source mock|pipe|replay:<plik>`.
10. Hook nagrywania: interfejs `Recorder` (implementację dostarcza S7) wpinany flagą `--record`.

## Definition of Done
- [ ] `npm run dev -w bridge -- --source mock` daje stabilny strumień zgodny z fixture'ami (testy kontraktu S7 zielone).
- [ ] Testy Vitest: mapping (fixture `ipc/tel.json` → oczekiwany `FastState`), throttling (progi, `seq`), CommandRouter (set-state na symulowanym źródle, timeouty, hold watchdog), auth (brak tokenu → 4003), filtr IP.
- [ ] Z fake-pipe (S7) i z prawdziwym DLL (S1): latencja pipe → WS wysłane < 2 ms p95 (log debug).
- [ ] Restart bridge'a nie wymaga ponownego parowania.
- [ ] `bridge/README.md`: uruchomienie, konfiguracja, zapora (reguła tylko dla profilu Private), parowanie.

## Jak testować bez gry
`--source mock` (scenariusze z `tools/mock`), `--source replay:<plik.yarec>`, fake-pipe z `tools/fake-pipe` (S7). Jeśli fake-pipe jeszcze nie istnieje, zrób minimalny test double w `bridge/test/`.

## Złożoność: **M/L**

## Stan po Fazie 0 (od czego zaczynasz)
Działa: `server.ts` (hello/snapshot/fast/slow/config/status/event, ping, resync, subscribe, moduły), `mapping.ts` (pełne mapowanie kanałów i configów), `commands.ts` (press + hold down/up), `sources/pipe.ts` (bazowy klient pipe), `modules/media.ts`. Test: `node scripts/smoke.ts`.
Znane braki F0 do naprawy przez Ciebie: (1) throttler ma **jeden wspólny zbiór „dirty”** — klienci z różnym `fastHz` gubią delty → zrób śledzenie per klient; (2) brak progów zmian; (3) `set` zwraca `not_supported`; (4) brak `keep`-watchdoga i rate limitu; (5) parowanie/tokeny (teraz tylko `--no-auth`); (6) alerty, trip, mDNS, recorder hook.
