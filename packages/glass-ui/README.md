# @yoga-auto/glass-ui

Design system „Liquid Glass” (React 19 + TS). Kontrakt: `docs/DESIGN.md` §2–§5.

## Użycie

```tsx
import "@yoga-auto/glass-ui/styles.css";
import { GlassProvider, GlassButton, Icon, usePerfTier } from "@yoga-auto/glass-ui";

<GlassProvider tier="auto" theme="dark" night={false}>
  <GlassButton size="lg" icon={<Icon name="lights-low" />} label="Mijania"
    active={telemetry.lowBeam} pending={pendingAck} tone="lights" onPress={toggleLowBeam} />
</GlassProvider>;
```

### Filtry refrakcji (dla shella / S4)

`GlassProvider` sam wywołuje `injectFilters()` (idempotentne). Żeby uniknąć wyścigu hydratacji, shell może też wkleić host filtrów do `index.html`:

```ts
import { filtersMarkup, FILTER_HOST_ID } from "@yoga-auto/glass-ui";
// filtersMarkup() zwraca markup SVG (host o id `lg-filters`); wstaw go jako pierwszy element `<body>`
```

Mapy przemieszczeń powstają w canvasie per `w×h×radius` (cache LRU, `DisplacementCache`), a `GlassSurface refract`
ustawia `--lg-refract-url` dopiero po wstawieniu filtra do DOM. Rozmiar zmienia się z debounce 120 ms przez `ResizeObserver`.

### Wartości bez re-renderu

```tsx
const speed = useRef<ValueHandle>(null);
<Numeric ref={speed} format={(v) => String(Math.round(v))} />
// w pętli telemetrii:
speed.current?.setValue(87.4);
```

`Gauge` działa tak samo (`ref.setValue`), wskazówka goni cel sprężyną `gauge`.

### Tiery i wydajność

| API | Opis |
|---|---|
| `usePerfTier()` | `{ tier, mode, setMode, stats, lastChange, batteryLimited }` |
| `setTier(t \| "auto")` | ręczny wybór; wyłącza auto-degradację |
| `FrameMonitor` | rAF, okna 2 s, p50/p95/p99; okna z ukrytą kartą są odrzucane |
| `PerfTierController` | progi i histereza z DESIGN.md §5 (czysta maszyna stanów, testowana na fake czasie) |
| `surfaces` | rejestr powierzchni z `backdrop-filter`; ponad limit tieru → render `flat` |
| zdarzenie `tierchange` | na `<html>`, `detail: TierChange` |

URL: `?perf=1` overlay (fps, p50/p95/p99, tier, liczba powierzchni, przełączniki), `?burn=1` (lub `?burn=<ms>`) sztuczne obciążenie do testu auto-degradacji.
Auto domyślnie awansuje najwyżej do `high` (`autoCeiling="ultra"` odblokowuje `ultra`). Bateria < 20% bez ładowania → sufit `lite`.

Odstępstwo od DESIGN.md §5: próg awansu „p95 < 12 ms” jest nieosiągalny na panelu 60 Hz (klatka 16.7 ms), więc to `max(12, p50 + 0.8)` z górnym limitem 17.6 ms (zawsze pod progiem degradacji 18 ms).

## Komponenty

`GlassProvider`, `GlassSurface`, `GlassPanel`, `GlassCard` (`onPress`, `onLongPress` ≥ 450 ms), `GlassButton` (`active`, `pending`, hold), `GlassToggle`, `GlassSegmented`, `GlassSlider`, `Dock`, `Sheet`, `Toast`/`ToastHost`, `StatusBar`, `Gauge`, `Numeric`, `Icon`.
Ikony pojazdu: `lights-parking`, `lights-low`, `lights-high`, `beacon`, `hazard`, `retarder`, `engine-brake`, `diff-lock`, `lift-axle`, `trailer`, `coupling`, `cruise`, `parking-brake`, `wipers`, `ignition`; własne dopinasz `registerIcon(name, node)`.

Opcjonalne propsy ponad tabelę z DESIGN.md §4 (zgodne wstecz): `GlassSurface.priority/backdrop`, `GlassButton.glass`, `GlassCard.onLongPress`, `Gauge.minorTicks/tickLabel/spring`, `Numeric.spring`, `GlassSlider.format/onCommit/length`.

## Ladle

```powershell
npm run ladle -w @yoga-auto/glass-ui   # http://localhost:61003
```

Story: `Komponenty/*` (każdy komponent; panel kontrolek: tier, tapeta, noc), `Tiery/*` (pełny zestaw w każdym tierze, auto, motyw jasny), `Stress/*` (20 kart, 60 Hz zmian liczb, po jednej story na tier + auto).
Auto-degradacja: `http://localhost:61003/?story=stress--auto&mode=preview&burn=1`.

## Testy

`npx vitest run packages/glass-ui`: histereza kontrolera (fake czas), cache map, `GlassButton` (press/pending/hold), kontrast ≥ 7:1 na 3 tapetach (liczony z tokenów).

## Raport wydajności (FrameMonitor)

> **Do uzupełnienia na Yodze.** Panel Browser w aplikacji Claude nie renderuje rAF, więc p95 nie zmierzono w środowisku agenta.
> Procedura: Edge, `…/?story=stress--high&mode=preview&perf=1`, odczekać 30 s, przepisać p50/p95/p99 z overlayu. Cel: p95 ≤ 16.7 ms.

| Story | p50 | p95 | p99 | Uwagi |
|---|---|---|---|---|
| stress @ high | – | – | – | do pomiaru |
| stress @ ultra | – | – | – | do pomiaru |
| stress @ auto + `?burn=1` | – | – | – | oczekiwane: high → lite → flat |
