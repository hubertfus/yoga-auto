# Notatka licencyjna: mapa (S8) — decyzja należy do właściciela

**Fakty (źródło: README projektu, strona GitHub):** `truckermudgeon/maps` („TruckSim Maps”) jest na licencji **GPL-3.0**. README nie opisuje parametrów projekcji współrzędnych gry; napisano tam też, że wygenerowane drogi/prefaby są „dalekie od doskonałych”.
Nie jestem prawnikiem; poniżej opcje, nie porada prawna.

## Co jest czym
| Element | Status |
|---|---|
| Kod `truckermudgeon/maps` | GPL-3.0. W tym repo **nie jest wklejony ani zvendorowany**; `map:build` klonuje go dopiero na polecenie użytkownika do `tools/map/.cache/` (ignorowane przez git) |
| `europe.pmtiles` wygenerowany z plików gry | Dane pochodne **plików gry SCS** (prawa SCS Software) i działania narzędzia GPL. Używanie prywatnie na własnym PC jest ok; **nie dystrybuujemy** go w repo |
| Konwersja x,z gry → lon/lat (`apps/yoga/src/features/map/projection.ts`) | Napisana od zera: klasyczny wzór LCC (publiczna matematyka, Snyder 1987) + kalibracja podobieństwem z kotwic. **Bez** kodu i stałych z repo GPL |
| `maplibre-gl` (BSD-3), `pmtiles` (BSD-3) | Zależności zgodne z dowolną opcją |

## Opcje
1. **Narzędzie zewnętrzne, projekt na dotychczasowej licencji (rekomendowane, stan obecny).** Użytkownik sam uruchamia `map:build` i dostaje kafle na własny dysk; repo nie zawiera kodu GPL ani danych map. Ryzyko: wywołanie CLI jako osobnego procesu jest zwykle uznawane za „mere aggregation”, a nie linkowanie; kafle trzymamy poza repo. Konwersja współrzędnych jest niezależną implementacją. Dla projektu osobistego ryzyko niskie.
2. **Cały projekt na GPL-3.0.** Pełna swoboda używania kodu i ew. wklejenia konwersji z ich kodu (gdyby kalibracja z kotwic okazała się za mało dokładna). Cena: wszyscy użytkownicy/forki muszą zachować GPL; kolizja z ew. planami komercyjnymi lub z bibliotekami niezgodnymi z GPL.
3. **Raster zamiast wektorów: `dariowouters/ts-map` (MIT).** Brak GPL, ale raster (mniej ostry na dotyku) i niepotwierdzona obsługa 1.6x (ANALYSIS §5.2). Wymagałoby przepisania części S8.
4. **Bez mapy (stan sprzed M4).** Ekran `nav` z dystansem/ETA.

## Rekomendacja
Opcja 1, o ile projekt jest prywatny/niekomercyjny. Przy zamiarze publikacji repo: nie dodawać `europe.pmtiles` ani plików z `tools/map/.cache/`, zostawić `LICENSE-NOTE` i README, rozważyć pytanie do autora narzędzia o wyjaśnienie zakresu GPL dla danych wyjściowych.

## Niepewność projekcji (dla decyzji)
Domyślne parametry LCC w `projection.ts` są **niezweryfikowane**. Bez GPL-owego kodu dokładność daje tylko kalibracja kotwicami (`npm run map:calibrate`): współrzędne gry i lon/lat tych samych miast bierzemy z **danych wyjściowych** narzędzia (to dane, nie kod). Jeśli to nie zejdzie poniżej ~20 m gry na zbliżeniu, jedyną czystą drogą do dokładniejszego modelu jest opcja 2.
