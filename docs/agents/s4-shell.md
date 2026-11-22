# Brief S4: shell aplikacji (PWA, kiosk, nawigacja)

## Kontekst projektu
**yoga-auto** to system w stylu CarPlay dla Euro Truck Simulator 2. PWA działa w **Edge `--kiosk`** na Lenovo Yoga z dotykiem i łączy się z bridge'em na PC przez WebSocket. Wygląd: Liquid Glass (iOS 26), dark mode, duże cele dotykowe.
Przeczytaj:
- `docs/DESIGN.md` §1, §6 (makiety), §7 (dotyk i kiosk)
- `docs/PROTOCOL.md` §2 (cykl życia WS, zasady klienta), §6 (HTTP parowania)
- `docs/ARCHITECTURE.md` (ADR-006, 007)
- `apps/yoga/src/core/*` z Fazy 0 (client, store, registry, commands)

## Cel
Szkielet aplikacji: Home w stylu CarPlay (dock + siatka kafli), router ekranów, status bar, host toastów, ekran parowania i łączenia, ustawienia, PWA (service worker, manifest), integracja kiosku (wake lock, blokada gestów) oraz utrzymanie warstwy `core` (klient protokołu i store).

## Katalogi
- **Posiadasz:** `apps/yoga/src/shell/**`, `apps/yoga/src/core/**` (od momentu przekazania po F0), `apps/yoga/index.html`, `apps/yoga/vite.config.ts`, `apps/yoga/public/**`, `apps/yoga/package.json`.
- **Nie ruszasz:** `apps/yoga/src/features/**` (S5/S6/S8), `packages/glass-ui` (S3), `shared/**`.
- `registry.ts` to Twój kontrakt z S5/S6/S8. Zmiany addytywne są OK, łamiące idą przez `docs/proposals/s4-*.md`.

## Zadania
1. **Core:** dopracuj `client.ts` (reconnect z backoff+jitter, `CLIENT_STALE_MS`, `seq`/`resync`, ping/RTT, `session`), `store.ts` (`useFastValue(selector, cb)` → rAF bez re-renderu; `useSlow`/`useConfig`/`useStatus`/`useAlerts` przez `useSyncExternalStore` z selektorami), `commands.ts` (`sendCmd`, optymistyczny stan, `pending`, timeout 2 s, hold z `keep` co 1 s).
2. **Shell:** layout (StatusBar 40 px, Dock po lewej w landscape / u dołu w portrait, obszar treści), router (ekrany z registry: `home`, `drive`, `vehicle`, `nav`, `media`, `settings`, w M4 `map`), przejścia springiem (gentle), swipe poziomy stron home.
3. **Home grid:** układ kafli 4×2 z registry (`WidgetDef { id, size, component }`), domyślny układ wg DESIGN.md §6.1, zapis układu w `localStorage` (edycja w M4).
4. **ToastHost:** mapowanie `alerts`/`event` → toasty (treść/ikony dostarcza S5 przez registry `alertPresenters`).
5. **Ekrany systemowe:** „Łączenie…” (z `/api/info`), parowanie (klawiatura PIN 6 cyfr, duże klawisze), „Gra nie działa”, ustawienia (jednostki km/h–mph, °C–°F, l–gal; motyw; tryb nocny; tier glass: auto/ultra/high/lite/flat; jasność = nakładka `--dim`; `fastHz`; reset tripu; info o połączeniu).
6. **Kiosk/PWA:** manifest (`display: fullscreen`, orientacja any), service worker (cache-first dla assetów, network-only dla `/api` i `/ws`), Screen Wake Lock (ponowne żądanie po `visibilitychange`), globalne blokady z DESIGN.md §7, `docs/kiosk.md` dla usera: skrót Edge z flagami (z ANALYSIS §4.2), autostart, polityka gestów krawędziowych, plan zasilania.
7. Wklejenie filtrów SVG z glass-ui do `index.html`.

## Definition of Done
- [ ] Na mocku (`npm run dev:mock` w root) pełna nawigacja po wszystkich ekranach. Dock, status bar i toasty działają.
- [ ] Parowanie od zera: PIN → token → reconnect po restarcie bridge'a bez ponownego parowania.
- [ ] Reconnect: zabicie bridge'a → ekran „Łączenie…” → powrót w < 5 s po starcie.
- [ ] Brak zoomu, scrolla, menu kontekstowego i zaznaczania tekstu na Yodze w kiosku (test ręczny wg checklisty w `docs/kiosk.md`).
- [ ] Vitest: client (reconnect, resync przy dziurze `seq`, stale), store (selektory, brak re-renderu przy zmianie niesubskrybowanego pola), commands (optymizm + rollback).
- [ ] Lighthouse PWA: installable, SW aktywny.

## Jak testować bez gry
`bridge --source mock` albo `--source replay:…`. Tryb dev Vite z proxy `/ws` i `/api` do bridge'a.

## Złożoność: **M**

## Stan po Fazie 0 (od czego zaczynasz)
`src/core/{client,store,commands,registry}.ts` działają (reconnect, ping/RTT, seq/resync, `useFastValue`, `usePending`, hold z keep). `src/main.tsx` auto-ładuje `src/features/*/index.ts(x)` przez `import.meta.glob` — nie ma wspólnego pliku rejestracji. `src/shell/App.tsx` to placeholder (status bar, dock, Home z rejestru, toasty z eventów). Dev: `npm run dev:bridge` + `npm run dev:app`. Bridge na razie działa z `--no-auth`; ekran parowania budujesz pod API z PROTOCOL.md §6 (S2 robi backend).
