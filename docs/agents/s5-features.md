# Brief S5: widgety i ekrany

## Kontekst projektu
**yoga-auto** to system w stylu CarPlay dla Euro Truck Simulator 2 na Lenovo Yoga (dotyk) obok kierownicy. Dane z gry przychodzą na żywo przez WebSocket z bridge'a na PC, a dotyk steruje grą (światła, tempomat itd.). Wygląd: Liquid Glass (iOS 26).
Przeczytaj:
- `docs/DESIGN.md` (§1 zasady, §4 komponenty, §6 makiety). **Używasz wyłącznie komponentów z `@yoga-auto/glass-ui`.**
- `docs/PROTOCOL.md` §3 (dane), §4 (komendy)
- `shared/protocol/src/state.ts` (jednostki!), `actions.ts`, `alerts.ts`, `events.ts`
- `apps/yoga/src/core/registry.ts`, `store.ts`, `commands.ts` (API od S4)
- `docs/ANALYSIS.md` §5

## Cel
Wszystkie funkcjonalne widgety i ekrany MVP: zegary, jazda, nawigacja/zlecenie, panel sterowania pojazdem, prezentacja alertów i eventów, komputer pokładowy.

## Katalogi
- **Posiadasz:** `apps/yoga/src/features/**` **oprócz** `features/media/**` (S6) i `features/map/**` (S8).
- **Nie ruszasz:** `apps/yoga/src/{core,shell}` (S4), `packages/glass-ui` (S3), `shared/**`. Brakuje komponentu albo propa? `docs/proposals/s5-*.md`, a do tego czasu lokalny komponent w `features/_local/` (do usunięcia po dostarczeniu przez S3).

## Zadania
1. `features/units`: formatery (m/s → km/h | mph, l → gal, °C → °F, minuty gry → „wt 16:00”, sekundy → „2 h 03”), zależne od ustawień.
2. **Widgety (registry `widgets`):** `speed` (2×1: prędkość, limit, bieg, CC), `rpm`, `fuel` (poziom, zasięg, AdBlue), `nav` (dystans, ETA, godzina przyjazdu), `job` (trasa, termin, zarobek, uszkodzenie ładunku), `lights` (segment mijania/postojowe/wył. + drogowe + awaryjne), `cruise` (SET/−/wartość/+/RES), `rest` (do odpoczynku), `status` (powietrze, temperatury, akumulator). Szybkie wartości wyłącznie przez `useFastValue` + `Numeric`/`Gauge.setValue`.
3. **Ekrany:** `drive` (DESIGN §6.2: duży zegar RPM/prędkości, limit, CC, retarder, ciśnienie, kierunkowskazy z animacją z `lights.blinker*On`), `vehicle` (DESIGN §6.3: wszystkie akcje z `ACTIONS` pogrupowane wg `group`; przycisk = `GlassButton` z `active` z telemetrii (`state`), `pending` z `commands`; akcje `hold` przez `onHoldStart/End`; akcje niedostępne (`not_supported` / `verified:false` bez potwierdzenia) wyszarzone z tooltipem), `nav` (DESIGN §6.4, MVP bez mapy), `trip` (komputer pokładowy z `slow.trip`, reset).
4. **Radio w grze:** sekcja z akcjami `radio.*` (wł./wył., stacja ±, głośność ±) na ekranie `vehicle` i jako kafel. Stan stacji nie jest w telemetrii, więc przyciski są bez podświetlenia. Ekran `media` (S6) może osadzić ten komponent (eksportuj `InGameRadioControls`).
5. **Alerty:** `alertPresenters` dla każdego `AlertCode` (ikona, tytuł, treść, poziom) i `eventPresenters` (job.delivered z podsumowaniem, mandat, myto, prom). Overspeed: subtelny czerwony rim na widgecie `speed`.
6. Mikrointerakcje: wskazówki ze springiem gauge (interpolacja między ramkami 30 Hz → płynne 60 fps), animacja zmiany biegu, pulsowanie kierunkowskazów zsynchronizowane z telemetrią.

## Definition of Done
- [ ] Każdy widget i ekran działa na mocku we wszystkich scenariuszach (`highway`, `city-night`, `low-fuel`, `crash`, `job-cycle`).
- [ ] Panel `vehicle`: każda akcja wysyła poprawny `cmd` (test z mock bridge'em). Stan przycisku zgadza się z telemetrią po ack, a rollback działa przy `ok:false`.
- [ ] Vitest + Testing Library: formatery jednostek (tabela przypadków), widgety renderują `null`/brak danych bez crasha, presentery dla wszystkich kodów alertów (test wyczerpujący po `AlertCode`).
- [ ] Profil React DevTools: brak re-renderów widgetów przy samych zmianach `fast.speed`/`rpm` (tylko imperatywne aktualizacje).
- [ ] Cele dotykowe ≥ 56 px dla akcji pojazdu.

## Jak testować bez gry
`npm run dev:mock`. Scenariusze mocka reagują na komendy (np. `lights.mode` zmienia `fast.lights`).

## Złożoność: **L**

## Stan po Fazie 0 (od czego zaczynasz)
Rejestracja: utwórz `src/features/<nazwa>/index.tsx` i wołaj `registerWidget/registerScreen/registerAlertPresenter/registerEventPresenter` z `core/registry.ts` — shell ładuje je automatycznie. `features/_dev` to diagnostyka z F0 (surowy widget `speed` + lista wszystkich akcji) — zastąp widget `speed` swoim, ekran diagnostyki możesz zostać. Komponenty glass-ui są na razie stubami (S3 dodaje efekty), API jest stabilne.
