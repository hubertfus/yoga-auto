# Brief S3: design system Liquid Glass

## Kontekst projektu
**yoga-auto** to system w stylu CarPlay dla Euro Truck Simulator 2, wyświetlany na Lenovo Yoga (dotyk, iGPU) w **Edge (Chromium) w trybie kiosk**. Wygląd: **Liquid Glass w stylu iOS 26**: półprzezroczyste, rozmyte warstwy szkła z refrakcją, odblaski na krawędziach, miękkie cienie, sprężynowe animacje, duże cele dotykowe, dark mode jako domyślny. Cel: 60 fps na iGPU z automatyczną degradacją.
Przeczytaj:
- `docs/DESIGN.md` (cały). **To Twój kontrakt:** tokeny, anatomia szkła, lista komponentów i propsów, tiery.
- `docs/ANALYSIS.md` §4.3 (technika, ograniczenia Chromium)
- `docs/ARCHITECTURE.md` ADR-007, ADR-008

## Cel
Pakiet `@yoga-auto/glass-ui` (React 19 + TS) z komponentami z DESIGN.md §4, efektem refrakcji, systemem tierów (`ultra/high/lite/flat`) z `FrameMonitor` i auto-degradacją, springami (`motion`) i ikonami kontrolek pojazdu.

## Katalogi
- **Posiadasz:** `packages/glass-ui/**`, `shared/design-tokens/**` (po przekazaniu przez leada po F0).
- **Nie ruszasz:** `apps/**` (shell i widgety używają Twojego API), `shared/protocol`.
- **API z F0 (sygnatury komponentów) jest kontraktem.** Zmiana sygnatury → `docs/proposals/s3-*.md`. Dodawanie opcjonalnych propsów jest OK.

## Zadania
1. `GlassSurface`: warstwy 1–6 z DESIGN.md §2; `refract` → `backdrop-filter: url(#lg-refract-…) blur() saturate()`.
2. **Generator map przemieszczeń:** canvas → data-URL dla `w×h×radius` (soczewka: przemieszczenie rośnie przy krawędzi, profil „squircle”), cache, `ResizeObserver` z debounce. Filtry SVG dostarczasz jako snippet `filters.html`/funkcję `injectFilters()`, którą S4 wkleja do `index.html` (unikamy wyścigu hydratacji).
3. Specular (statyczny; w `ultra` sterowany `--tilt` z pozycji dotyku/drag), rim gradient (mask-composite).
4. `FrameMonitor` (rAF, okna 2 s, p50/p95/p99), `PerfTierController` (progi i histereza z DESIGN.md §5, limit liczby aktywnych powierzchni z `backdrop-filter`: rejestr powierzchni, ponad limit → render jako `flat`), `usePerfTier`, overlay `?perf=1`, bateria.
5. Komponenty: `GlassPanel`, `GlassCard`, `GlassButton` (active/pending/hold z pointer capture, feedback < 50 ms), `GlassToggle`, `GlassSegmented`, `GlassSlider`, `Dock`, `Sheet` (detenty, drag-to-dismiss), `Toast`/`ToastHost`, `StatusBar`, `Gauge`, `Numeric` (imperatywne `setValue` bez re-renderu, spring gauge), `Icon` (+ własne SVG: światła postojowe/mijania/drogowe, kogut, awaryjne, retarder, blokada mostu, oś podnoszona, naczepa, tempomat, hamulec postojowy).
6. Motyw: dark (domyślny), night (`--dim`, ciepły akcent), light. `prefers-reduced-motion`.
7. **Ladle** (`npm run ladle -w @yoga-auto/glass-ui`): story dla każdego komponentu i każdego tieru na tapecie testowej + story „stress” (20 kart, 60 Hz zmiany liczb).

## Definition of Done
- [ ] Wszystkie komponenty z DESIGN.md §4 z propsami jak w tabeli, typy eksportowane.
- [ ] Refrakcja widoczna w Edge w `ultra`/`high`; `lite`/`flat` bez `backdrop-filter: url()`.
- [ ] Story „stress” w `high` na laptopie z iGPU: p95 ≤ 16.7 ms (raport z `FrameMonitor` w README); auto-degradacja zadziała pod sztucznym obciążeniem (`?burn=1`).
- [ ] Testy (Vitest + Testing Library): hold/press/pending w `GlassButton`, histereza `PerfTierController` (fake timers), cache generatora map.
- [ ] Cele dotykowe ≥ wartości `--hit-*`; kontrast tekstu na szkle ≥ 7:1 (sprawdzony na 3 tapetach).
- [ ] `packages/glass-ui/README.md` z przykładami użycia.

## Jak testować bez gry
Gra nie jest potrzebna. Ladle + sztuczne dane. Benchmark na Yodze: otwórz Ladle w Edge z `?perf=1`.

## Złożoność: **L**

## Stan po Fazie 0 (od czego zaczynasz)
`packages/glass-ui/src/*` ma wszystkie komponenty z DESIGN.md §4 jako proste stuby z finalnymi propsami + `styles.css` (bez refrakcji). Tokeny: `shared/design-tokens/tokens.json` → `npm run gen` → `generated/tokens.css|ts` (teraz Twoje). Index.html aplikacji ma placeholder filtra `#lg-refract` — dostarcz docelowe definicje/`injectFilters()` i opisz S4, jak je wpiąć. Ladle dodaj jako devDependency swojego pakietu.
