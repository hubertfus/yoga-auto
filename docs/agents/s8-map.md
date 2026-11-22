# Brief S8: mapa świata (etap M4)

## Kontekst projektu
**yoga-auto** to system w stylu CarPlay dla Euro Truck Simulator 2 na Lenovo Yoga (dotyk, Edge kiosk). Bridge na PC wysyła telemetrię przez WebSocket, w tym `fast.placement` (x, y, z, heading w układzie świata gry; maks. 10 Hz, po `subscribe { placement: true }`). M1–M3 są gotowe: shell, widgety, Liquid Glass. Teraz dodajemy mapę.
Przeczytaj:
- `docs/ANALYSIS.md` §5.2 (ocena opcji, licencje)
- `docs/ARCHITECTURE.md` ADR-010
- `shared/protocol/src/state.ts` (`Placement`), `messages.ts` (`SubscribeMsg`), `docs/PROTOCOL.md` §6 (`/tiles/*`)
- https://github.com/truckermudgeon/maps (README: `parser`, `generator`, PMTiles, MapLibre). **Licencja GPL-3.0.**

## Cel
1. `tools/map`: skrypt, który z plików gry użytkownika generuje `europe.pmtiles` (+ sprite'y, etykiety miast) przy użyciu truckermudgeon/maps jako **zewnętrznego narzędzia** (klon do `tools/map/.cache/`, nie vendorujemy kodu). Wymaga `tippecanoe` (WSL albo prebuilt; opisz).
2. `apps/yoga/src/features/map`: ekran `map` i tło ekranu `nav`. MapLibre GL JS + protokół `pmtiles`, ciemny styl dopasowany do tokenów, marker ciężarówki z kierunkiem (spring), tryb follow / swobodny, gesty dotykowe (pinch zoom tylko na mapie, mimo globalnej blokady).
3. Konwersja współrzędnych świata gry → lon/lat zgodna z projekcją użytą przy generowaniu kafli.

## Katalogi
- **Posiadasz:** `tools/map/**`, `apps/yoga/src/features/map/**`.
- **Nie ruszasz:** `bridge/**` (serwowanie `/tiles` z `Range` to zadanie S2; zgłoś przez `docs/proposals/s8-*.md`, jeśli trzeba czegoś więcej), `shared/**`, reszta `apps/`.

## Zadania
1. **Spike licencyjny i techniczny:** jak truckermudgeon/maps mapuje współrzędne gry na geograficzne (ETS2 ma własną projekcję)? Czy da się to odtworzyć z publicznie opisanych parametrów bez kopiowania kodu GPL, czy lepiej, żeby **cały projekt** przyjął GPL-3.0? Decyzję podejmuje właściciel projektu. Przygotuj notatkę `tools/map/LICENSE-NOTE.md` z opcjami.
2. Skrypt generacji (`npm run map:build -- --game "C:\...\Euro Truck Simulator 2"`): wersja gry i lista DLC w metadanych wyniku.
3. Ekran mapy + marker + follow. Wydajność: mapa jest **pod** szkłem, więc w trakcie panningu tier lokalnie spada do `lite` dla powierzchni nad mapą (API od S3: `usePerfTier().override`).
4. Opcjonalnie: wyróżnienie miasta docelowego z `config.job.destination.cityId`.

## Definition of Done
- [ ] Z plików gry 1.62 generuje się `europe.pmtiles`, a bridge go serwuje.
- [ ] Na Yodze mapa z markerem, który porusza się płynnie zgodnie z jazdą (błąd pozycji < 20 m na zbliżeniu miejskim).
- [ ] 60 fps przy follow na Home/nav w tierze `high` (benchmark S7).
- [ ] README + notatka licencyjna.

## Jak testować bez gry
Replay `.yarec` z prawdziwej jazdy (S7) daje realne `placement`. Kafle generuje się raz z plików gry na dysku. Sama gra nie musi być uruchomiona.

## Złożoność: **M**
