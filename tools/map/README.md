# tools/map — kafle mapy dla yoga-auto (S8)

Mapa w aplikacji (ekran `map`, tło ekranu `nav`) renderuje **MapLibre GL JS** z kafli **PMTiles**. Kafle powstają **raz**, z plików Twojej gry, zewnętrznym narzędziem [truckermudgeon/maps](https://github.com/truckermudgeon/maps) (**GPL-3.0**, patrz `LICENSE-NOTE.md`). Nic stąd nie jest pobierane ani uruchamiane automatycznie (ani przez `npm install`, ani przez `npm run check`).

Bez kafli aplikacja pokazuje pusty ciemny kafel mapy z markerem ciężarówki i komunikatem „brak kafli, uruchom map:build”.

## Wymagania
- Node ≥ 24, `git`, `npm` w PATH.
- `tippecanoe` w PATH (generator PMTiles): na Windows najprościej w **WSL** (`sudo apt install tippecanoe`, wtedy uruchom `map:build` z poziomu WSL) albo prebuilt.
- Zainstalowane ETS2 z DLC map, które chcesz mieć na mapie (mody map nieobsługiwane przez narzędzie).
- ~ kilka GB wolnego miejsca na dane pośrednie.

## Co, skąd i ile `map:build` pobiera (dopiero po Twoim uruchomieniu)
| Krok | Źródło | Rozmiar (szacunek) |
|---|---|---|
| `git clone --depth 1 --recurse-submodules` | https://github.com/truckermudgeon/maps → `tools/map/.cache/maps` | setki MB (z submodułami) |
| `npm install` w klonie + build parsera (node-gyp) | rejestr npm | kilkaset MB |
| `parser -i <gra> -o .cache/parsed` | czyta Twoje pliki gry (tylko odczyt) | wyjście: GB |
| `generator map -m europe` | lokalnie, wymaga tippecanoe | wynik `europe.pmtiles`: setki MB |

Skrypt zawsze pyta o zgodę przed pobraniem (pomiń: `--yes`). Sprawdzenie planu **bez pobierania**:

```powershell
npm run map:build -w @yoga-auto/map-tools -- --game "C:\Program Files (x86)\Steam\steamapps\common\Euro Truck Simulator 2" --dry-run
```

Właściwe uruchomienie:

```powershell
npm run map:build -w @yoga-auto/map-tools -- --game "C:\Program Files (x86)\Steam\steamapps\common\Euro Truck Simulator 2"
```

Wynik: `tools/map/out/meta.json` (data, wersja gry z `version.txt`, lista `dlc_*.scs`, commit narzędzia). `europe.pmtiles` powstaje wg README narzędzia (komenda `generator map -m europe`; jeśli zapisze w innym miejscu, skopiuj go do `tools/map/out/`). Dodatkowe argumenty generatora: `--generator-args "..."`.
> Uwaga: skrypt jest napisany wg opisu README narzędzia i **nie był uruchamiany** (nie pobieraliśmy danych). Kroki/flagi mogą wymagać korekty po pierwszym uruchomieniu.

## Serwowanie kafli
Docelowo bridge serwuje `GET /tiles/europe.pmtiles` (z `Range`, token `?k=`) — PROTOCOL §6; to zadanie S2 (zgłoszone: `docs/proposals/s8-tiles-serving.md`). Aplikacja szuka `/tiles/europe.pmtiles` i `/tiles/projection.json` pod adresem bridge'a. Na czas developmentu można je też położyć w `apps/yoga/public/tiles/` (tylko lokalnie; nie commitujemy).

## Kalibracja projekcji (ważne dla dokładności)
Współrzędne gry (x, z) muszą trafić w te same lon/lat co kafle. README narzędzia nie publikuje parametrów, a kodu GPL nie kopiujemy, więc `apps/yoga/src/features/map/projection.ts` ma model LCC + **kalibrację z kotwic**:

1. Z danych wyjściowych narzędzia (np. lista miast: nazwa, x, z, lon, lat) wybierz 5–10 miast rozrzuconych po całej mapie.
2. Zapisz `anchors.json`: `[{ "x": -31000, "z": -5500, "lon": 1.86, "lat": 50.95 }, ...]` (x, z w metrach gry, lon/lat w stopniach).
3. `npm run map:calibrate -w @yoga-auto/map-tools -- anchors.json tools/map/out/projection.json` — wypisze RMS (cel < 20 m gry).
4. Wystaw `projection.json` obok `europe.pmtiles` (`/tiles/projection.json`). Bez niego marker będzie w złym miejscu (domyślne parametry są niezweryfikowane).

## Trasa GPS (graf dróg) — `route-graph.bin`
SDK gry nie podaje trasy z nawigacji, więc bridge liczy ją sam (A* po grafie dróg, od ciężarówki do firmy docelowej zlecenia) i wysyła do tabletu: linia trasy na mapie + manewry („za 300 m skręć w prawo”, „prosto przez 200 km”). Dystanse manewrów są w skali gry (×19 poza miastem, ×3 w mieście), jak w GPS w grze.

Graf powstaje z tych samych danych parsera co kafle:
1. `parser` (już w `map:build`) → `tools/map/.cache/parsed/europe-*.json`,
2. `npx generator graph -m europe -i <parsed> -o tools/map/.cache/graph` (narzędzie truckermudgeon/maps),
3. `npm run map:graph` → `tools/map/out/route-graph.bin` (~8 MB; format własny, opis w `bridge/src/route/graph.ts`),
   `route-places.json` (miasta i firmy do wyszukiwarki celu na tablecie) oraz `icons/*.png` (ikony POI na mapie: stacje, parkingi, serwisy, logo firm, numery dróg — z danych parsera).

`map:build` robi kroki 2–3 automatycznie. Przy budowaniu w Dockerze (obraz z narzędziem): zamontuj katalog gry tylko do odczytu i `tools/map/.cache` jako `/work`, uruchom `npx parser -i /game -o /work/parsed` i `npx generator graph -m europe -i /work/parsed -o /work/graph`, potem na PC `npm run map:graph`.

Cel trasy: firma docelowa zlecenia albo cel wybrany na tablecie (wyszukiwarka 🔍 na ekranie Mapa / „Wybierz cel” w Nawigacji, albo przytrzymanie palca na mapie → „Nawiguj tutaj”). SDK nie udostępnia celu ustawionego w GPS gry, więc jazdy bez zlecenia trzeba wskazać na tablecie. Nowe zlecenie zastępuje cel ręczny; postój przy celu kończy nawigację.

Bridge wczytuje `route-graph.bin` z katalogu kafli przy starcie (log: „trasa GPS: graf … węzłów”). Bez pliku trasa jest wyłączona, a tablet pokazuje „brak grafu dróg”. Po aktualizacji gry/DLC wygeneruj graf ponownie (nowe drogi i firmy).

## Jezdnie z pasami — `roads.pmtiles`
Kafle truckermudgeon mają tylko linię środka drogi, więc na zbliżeniu drogi są cienkie i nie widać, którym pasem jedzie ciężarówka. `npm run map:lanes` buduje z danych parsera (drogi, węzły, `roadLooks`) osobne kafle `roads.pmtiles` (warstwa `lanes`, ~40 MB): każdy odcinek z liczbą pasów w każdą stronę, szerokością pasa i pasem rozdzielającym. Mapa rysuje z nich od zoomu ~11,5 jezdnie w prawdziwej skali, oś drogi i przerywane linie między pasami (przejazdy przez prefaby — węzły, mosty — zostają z kafli bazowych jako podkład).

Wymaga `projection.json` (kalibracja) i `tippecanoe` — w PATH albo w obrazie Dockera:

```powershell
npm run map:lanes -- --docker yoga-map-builder:latest
```

Bez `roads.pmtiles` mapa działa jak wcześniej (drogi z kafli bazowych, szerokość wg typu drogi).

## Uruchomienie aplikacji
Mapa działa na mocku/replayu (`npm run dev:mock`, `npm run dev:replay`) — marker porusza się po pustym tle bez kafli; z kaflami i `projection.json` pokazuje drogi.
