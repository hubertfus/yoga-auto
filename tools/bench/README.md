# bench — benchmark fps i latencji (S7)

Mierzy płynność dashboardu: ekran × tier szkła × częstotliwość `fast` (30/60 Hz). Bridge z mockiem serwuje zbudowaną
aplikację (`apps/yoga/dist`, port **7424**), Playwright (Edge/Chrome/Chromium) otwiera ją, a w stronie pętla
`requestAnimationFrame` zbiera odstępy między klatkami. Dodatkowo CDP `Performance.getMetrics` (czas skryptu, layoutu,
style recalc, sterta) i opcjonalnie trace (`--trace`).

## Jedno polecenie

```powershell
node tools/bench/src/cli.ts                        # pełny przebieg: 4 ekrany × 4 tiery × 2 Hz × 10 s
node tools/bench/src/cli.ts --seconds 5 --hz 60 --tiers high,flat --no-build
```

Wynik: `tools/bench/reports/latest.html` + `latest.json` (oraz kopie ze znacznikiem czasu; katalog w `.gitignore`).
Raport: fps, p50/p95/p99/max czasu klatki, klatki zgubione (> 25 ms = 1.5 × 16.7 ms), jank (> 50 ms), CDP.

| Opcja | Znaczenie |
|---|---|
| `--seconds N` | czas pomiaru jednego przebiegu (po 2 s rozgrzewki) |
| `--hz 30,60` | `fastHz` bridge'a (domyślny rate WS dla klienta) |
| `--tiers ultra,high,lite,flat` | wymusza `data-tier` na `<html>` (MutationObserver odpiera nadpisanie przez app); raport pokazuje „zastosowano”, jeśli się rozjedzie |
| `--screens Home,Drive=Jazda,Vehicle=Pojazd` | `Nazwa=etykieta przycisku docka` (aria-label); `Home` = bez klikania. Brak przycisku → przebieg „pominięto” (np. ekrany S5, których jeszcze nie ma) |
| `--scenario` | scenariusz mocka (domyślnie `highway`) |
| `--no-build` | nie buduj aplikacji (użyj istniejącego `dist`) |
| `--trace` | zapis `trace-*.json` (Tracing: devtools.timeline, frame, cc) do wczytania w DevTools/Perfetto |
| `--channel msedge\|chrome\|chromium` | przeglądarka; domyślnie Edge → Chrome → bundlowany Chromium. Nic nie jest pobierane automatycznie |
| `--headed` | okno widoczne |

## Tryb ręczny na Yodze (`?bench=1`)

Aplikacja nie ma jeszcze trybu `?bench=1` (S4); do tego czasu wklej w konsolę przeglądarki na Yodze:

```powershell
node tools/bench/src/cli.ts snippet --seconds 10     # drukuje kod do wklejenia
```

Wynik (tier, fps, p50/p95/p99, zgubione, UA) jest wypisany i kopiowany do schowka (`copy(...)`).

## Latencja bridge → UI

```powershell
node tools/bench/src/cli.ts latency --seconds 10 --hz 60
```

Klient WS: `ping{t0}` → `pong{t0,ts}` daje RTT i offset zegara (mediana, NTP-owo); opóźnienie jednokierunkowe
= odbiór − offset − `fast.ts`; plus jitter odstępów `fast`. **Ograniczenie:** `fast.ts` to czas bridge'a, więc odcinek
gra → bridge (pipe) wymaga znacznika czasu z pluginu — do zrobienia w sesji integracyjnej z grą.

## Uwagi

- Na Windows `setInterval` mocka bywa ~30 ms zamiast 16.7 ms, więc rzeczywisty rate `fast` przy „60 Hz” z mocka to ok. 33 Hz
  (widać w `fastIntervalMs`). Do testów UI pod obciążeniem 60 Hz użyj `createMockSource({ fps })` / fake-pipe z `--fps`.
- Headless Edge/Chromium ma vsync 60 Hz; wyniki na desktopie nie zastępują pomiaru na Yodze (tryb ręczny).
- Testy jednostkowe statystyk: `npx vitest run tools/bench`.
