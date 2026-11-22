# yoga-auto — design system „Liquid Glass”

Inspiracja: iOS 26 Liquid Glass i CarPlay. **Nie kopiujemy** zasobów Apple (ikon SF Symbols, tapet, czcionki SF). Używamy open-source'owych odpowiedników (Inter / Inter Display, ikony Lucide albo Phosphor).

## 1. Zasady

1. **Treść jest najważniejsza, szkło jest warstwą sterowania.** Szkło unosi się nad tłem (tapeta, mapa), a dane leżą na szkle.
2. **Szybko zmieniające się rzeczy nigdy pod szkłem.** Zegary, liczby i wskazówki leżą na powierzchni szkła albo na nieprzezroczystych kartach. Pod szkłem jest tylko tło statyczne lub wolnozmienne (to warunek wydajności `backdrop-filter`).
3. **Duże cele dotykowe.** Minimum **56 px** dla akcji pojazdu, 48 px dla elementów drugorzędnych, odstęp ≥ 12 px. Tryb jazdy: najważniejsze przyciski 72–88 px.
4. **Czytelność w ruchu.** Główne liczby ≥ 64 px, kontrast ≥ 7:1 na szkle (tint + tekst z cieniem 0 1px 2px). Bez cienkich fontów poniżej 20 px.
5. **Dark first.** Domyślnie ciemny. Tryb nocny dodatkowo przyciemnia (`--dim`) i ociepla barwy. Jasny motyw na dzień jest opcjonalny.
6. **Ruch fizyczny.** Sprężyny zamiast krzywych czasowych. Wejście elementów: skala 0.96 → 1 + opacity. Naciśnięcie: skala 0.94, odbicie springiem. Bez animacji dłuższych niż 450 ms. `prefers-reduced-motion` → crossfade.
7. **Stan widać zawsze.** Każdy przycisk akcji pokazuje stan z telemetrii (świeci, gdy aktywne) i stan „oczekuje” (pulsujący ring), dopóki nie przyjdzie `ack`.

## 2. Anatomia szkła

```
┌──────────────────────────── element .glass ────────────────────────────┐
│ 1. backdrop: blur(--glass-blur) saturate(--glass-sat) [+ url(#lg-refract)]│
│ 2. tint:     background: color-mix(in oklch, --glass-tint X%, transparent)│
│ 3. rim:      ::before — gradient obramowania 1px (mask-composite exclude)│
│              jaśniejszy u góry (światło z góry), ciemniejszy u dołu       │
│ 4. specular: ::after — miękki highlight (radial-gradient) w lewym górnym  │
│              rogu; w trybie ultra przesuwa się z --tilt (żyroskop/drag)   │
│ 5. inner:    box-shadow inset 0 1px 0 rgba(255,255,255,.25),             │
│                         inset 0 -1px 0 rgba(0,0,0,.25)                   │
│ 6. depth:    box-shadow 0 8px 32px rgba(0,0,0,.35) (warstwa = wyżej)      │
└───────────────────────────────────────────────────────────────────────┘
```

**Refrakcja (tylko `ultra`/`high`):** `<svg>` w `index.html` z filtrami `#lg-refract-{preset}`. `feImage href` = mapa przemieszczeń wygenerowana w canvasie dla danego `w×h×radius` (cache w `Map`, data-URL) → `feDisplacementMap in="SourceGraphic" scale="var"` z kanałami R/G. Efekt: krawędzie „zaginają” tło jak gruba soczewka, środek pozostaje płaski.

## 3. Tokeny

Źródło: `shared/design-tokens/tokens.json` (Faza 0) → generowane `tokens.css` (custom properties) i `tokens.ts`.

### 3.1 Kolory (OKLCH, dark)

| Token | Wartość | Użycie |
|---|---|---|
| `--bg-0` | `oklch(14% 0.01 260)` | tło aplikacji (pod tapetą) |
| `--glass-tint` | `oklch(30% 0.02 260)` | bazowy tint szkła |
| `--glass-tint-strong` | `oklch(22% 0.02 260)` | sheet, modal |
| `--text-1` | `oklch(98% 0 0)` | tekst główny |
| `--text-2` | `oklch(80% 0.01 260)` | opisy |
| `--text-3` | `oklch(62% 0.01 260)` | wyłączone |
| `--accent` | `oklch(72% 0.17 245)` | akcent systemowy (niebieski) |
| `--on` | `oklch(80% 0.19 150)` | stan „włączone” (zielony) |
| `--lights` | `oklch(88% 0.16 95)` | światła (bursztyn/żółty) |
| `--beam-high` | `oklch(75% 0.15 250)` | drogowe (niebieski, jak kontrolka) |
| `--warn` | `oklch(80% 0.17 75)` | warning |
| `--crit` | `oklch(65% 0.23 25)` | critical |
| `--rim-top` | `rgb(255 255 255 / .45)` | górna krawędź |
| `--rim-bottom` | `rgb(255 255 255 / .08)` | dolna krawędź |

Tryb nocny: `--dim: 0.75` mnoży jasność tekstu i akcentów, `--accent` przesuwa się na hue 60 (ciepły). Jasny motyw: osobny zestaw w `[data-theme=light]`.

### 3.2 Pozostałe

| Grupa | Tokeny |
|---|---|
| Promienie | `--r-xs 10` · `--r-sm 16` · `--r-md 22` · `--r-lg 28` · `--r-xl 36` · `--r-pill 999` (px) |
| Blur (wg trybu) | `--glass-blur`: ultra 24 · high 20 · lite 10 · flat 0 |
| Saturacja | `--glass-sat`: 180% (flat: 100%) |
| Refrakcja | `--refract-scale`: ultra 38 · high 28 · lite/flat 0 |
| Cienie | `--shadow-1 0 4px 16px rgb(0 0 0/.25)` · `--shadow-2 0 8px 32px rgb(0 0 0/.35)` · `--shadow-3 0 16px 48px rgb(0 0 0/.45)` |
| Spacing (4-pt) | `--s-1 4` · `--s-2 8` · `--s-3 12` · `--s-4 16` · `--s-5 24` · `--s-6 32` · `--s-7 48` · `--s-8 64` |
| Cele dotykowe | `--hit-sm 48` · `--hit-md 56` · `--hit-lg 72` · `--hit-xl 88` |
| Typografia | Inter Variable (tabular-nums dla liczb). `--t-display 96/1 700` (prędkość) · `--t-h1 48/1.1 650` · `--t-h2 32/1.15 600` · `--t-body 20/1.3 500` · `--t-label 16/1.2 600` · `--t-caption 14/1.2 500` |
| Motion (springi dla `motion`) | `--spring-snappy {stiffness 520, damping 34}` (przyciski) · `--spring-smooth {300, 30}` (karty, dock) · `--spring-gentle {170, 26}` (sheet, ekrany) · `--spring-gauge {120, 20, mass .8}` (wskazówki, interpolacja telemetrii) |
| Czas | `--dur-fast 120ms` · `--dur-base 220ms` · `--dur-slow 380ms` (crossfade dla reduced motion) |
| Z-index | `wallpaper 0` · `content 10` · `dock 20` · `sheet 30` · `toast 40` · `overlay 50` |

## 4. Komponenty (`packages/glass-ui`)

| Komponent | Propsy (skrót) | Uwagi |
|---|---|---|
| `GlassProvider` | `tier?: PerfTier \| "auto"`, `theme`, `night` | montuje filtry SVG? NIE, filtry są w `index.html`. Provider ustawia `data-tier`, startuje `FrameMonitor` |
| `GlassSurface` | `as`, `radius`, `elevation 1-3`, `refract?: boolean`, `tint?: "default" \| "strong" \| "clear"` | prymityw; reszta komponentów go używa |
| `GlassPanel` | `title?`, `padding`, children | panel z nagłówkiem |
| `GlassCard` | `onPress?`, `size: "1x1" \| "2x1" \| "2x2" \| "4x2"`, `accent?` | kafel/widget na home; obsługa long-press (edycja układu, M4) |
| `GlassButton` | `size: sm/md/lg/xl`, `icon`, `label?`, `variant: "plain" \| "tinted" \| "filled"`, `active?`, `pending?`, `tone?: "on" \| "lights" \| "warn" \| "crit"`, `onPress`, `onHoldStart/onHoldEnd` | `active` = świeci (stan z telemetrii); `pending` = pulsujący ring; hold z `pointerdown/up/cancel` + `setPointerCapture` |
| `GlassToggle` | `checked`, `onChange`, `label` | duży (56 px wysokości) |
| `GlassSegmented` | `options`, `value`, `onChange` | np. Światła: Wył./Postojowe/Mijania |
| `GlassSlider` | `min/max/step`, `value`, `onChange`, `vertical?` | thumb ≥ 44 px; stopnie retardera |
| `Dock` | `items: {id, icon, label, badge?}[]`, `active`, `onSelect`, `position: "left" \| "bottom"` | CarPlay-like, refrakcja zawsze (gdy tier ≥ high) |
| `Sheet` | `open`, `onClose`, `detents: ["medium","large"]`, drag-to-dismiss | spring gentle; tło przyciemnione |
| `Toast` / `ToastHost` | `level`, `title`, `body?`, `icon`, `duration`, `action?` | stos max 3, w stylu iOS (pigułka u góry, rozwijana), swipe-up dismiss |
| `StatusBar` | slots: lewy (czas gry, czas real), środek (alert), prawy (połączenie, RTT, media mini) | wysokość 40 px |
| `Gauge` (prymityw) | `value`, `min/max`, `arc`, `ticks`, `redline?` | renderuje SVG; wartość przez `ref.setValue()` (bez re-renderu) + spring gauge |
| `Numeric` | `ref.setValue(n)`, `format` | tabular-nums, bez re-renderu |
| `Icon` | `name` | Lucide/Phosphor + własne ikony kontrolek (światła, retarder, difflock) w `icons/` |

**API wydajności:** `usePerfTier()`, `FrameMonitor` (p50/p95/p99 czasu klatki w oknie 2 s), `setTier()`, event `tierchange`. Diagnostyka `?perf=1` pokazuje overlay fps i tier.

## 5. Tryby wydajności (`data-tier`)

| | `ultra` | `high` | `lite` | `flat` |
|---|---|---|---|---|
| blur | 24 | 20 | 10 | — |
| refrakcja | wszystkie `refract` | tylko Dock + Sheet | — | — |
| specular | animowany (`--tilt`) | statyczny | statyczny | gradient |
| maks. powierzchni z `backdrop-filter` naraz | 8 | 6 | 4 | 0 |
| tapeta | wideo/animowany gradient | statyczna | statyczna | jednolita |
| przejście w dół | p95 > 18 ms przez 2 okna | p95 > 18 ms | p95 > 22 ms | — |
| przejście w górę | — | p95 < 12 ms przez 30 s, max 1×/5 min | j.w. | j.w. |

## 6. Makiety ekranów (landscape, bazowo 1280×800 CSS px)

### 6.1 Home (CarPlay)

```
┌───────────────────────────────────────────────────────────────────────────┐
│ 14:32  (gra 08:17)                ⚠ Ograniczenie 80        ●  12 ms  ♪ ▮▮ │ StatusBar
├──────┬────────────────────────────────────────────────────────────────────┤
│      │ ┌───────────────────────────┐ ┌───────────────┐ ┌───────────────┐  │
│ (🏠) │ │        87  km/h           │ │  NAWIGACJA    │ │  ZLECENIE     │  │
│      │ │   ⦿ 80      🛞 12  ⛽ 63% │ │  184 km       │ │  Wrocław →    │  │
│ (⏱) │ │   CC 85     RPM ▮▮▮▮▯     │ │  ETA 2 h 03   │ │  Hamburg      │  │
│      │ │                           │ │  → 16:35      │ │  €18 450      │  │
│ (🚦) │ └───────────────────────────┘ └───────────────┘ └───────────────┘  │
│      │ ┌───────────────┐ ┌───────────────┐ ┌───────────────────────────┐  │
│ (🗺) │ │ ŚWIATŁA       │ │ TEMPOMAT      │ │ ♪ Teraz gra               │  │
│      │ │ [Mij.] [Drog] │ │ [−] 85 [+]    │ │ Artist – Title            │  │
│ (♪)  │ │ [⚠ Awaryjne]  │ │ [SET] [RES]   │ │ [⏮] [⏯] [⏭]               │  │
│      │ └───────────────┘ └───────────────┘ └───────────────────────────┘  │
│ (⚙)  │                                                                    │
└──────┴────────────────────────────────────────────────────────────────────┘
  Dock (szkło z refrakcją, 88 px)      Grid kafli 4×2 (GlassCard 2x1 / 1x1)
```

### 6.2 Jazda (Zegary)

```
┌───────────────────────────────────────────────────────────────────────────┐
│ StatusBar                                                                 │
├──────┬────────────────────────────────────────────────────────────────────┤
│ Dock │        ╭──────── RPM ────────╮            ╭──── 80 ────╮           │
│      │      ╱   1180  ×100            ╲          │  limit     │           │
│      │     │        8 7 km/h            │        ╰────────────╯           │
│      │     │        bieg  12            │        CC  85 km/h               │
│      │      ╲   ◀ ▶  ⛽ ▮▮▮▮▮▯ 1310 km ╱         Retarder ▮▮▯▯▯ 2/5        │
│      │        ╰─────────────────────╯            Powietrze 118 psi ✓       │
│      │  [◀ Kier.]  [⚠]  [Kier. ▶]   [P Ręczny]   [Hamulec silnikowy]       │
└──────┴────────────────────────────────────────────────────────────────────┘
```

### 6.3 Pojazd (panel sterowania)

```
┌──────┬────────────────────────────────────────────────────────────────────┐
│ Dock │ ŚWIATŁA          [Wył.|Postojowe|Mijania]   [Drogowe]   [Kogut]      │
│      │ SYGNAŁY          [◀]  [⚠ Awaryjne]  [▶]     [Klakson ⦿ hold]  [Pneum]│
│      │ WYCIERACZKI      [0][1][2][3][4]                                    │
│      │ HAMULCE          [P Ręczny]  [Silnikowy]  Retarder [−] ▮▮▯▯▯ [+]     │
│      │ TEMPOMAT         [SET]  [−]  85  [+]  [RES]                          │
│      │ OSIE / NACZEPA   [Blokada mostu]  [Oś podn.]  [Oś naczepy]  [Zaczep] │
│      │ SILNIK           [Zapłon]  [Start/Stop]                              │
│      │ GRA              [Kamera 1..8 ▸]  [Mapa] [GPS] [Screenshot] [Pauza]  │
└──────┴────────────────────────────────────────────────────────────────────┘
  Każdy przycisk: GlassButton size=lg, active = stan z telemetrii, pending = ring
```

### 6.4 Nawigacja / Zlecenie

```
┌──────┬──────────────────────────────────┬─────────────────────────────────┐
│ Dock │  (M4: mapa MapLibre, pełne tło)  │ ZLECENIE (GlassPanel, strong)   │
│      │                                  │ Elektronika · 18 t              │
│      │        ▲ (ciężarówka)            │ Wrocław, Tradeaux               │
│      │                                  │   ↓  812 km                     │
│      │  MVP: zamiast mapy duża karta    │ Hamburg, LKW                    │
│      │  dystans + ETA + limit           │ Termin: wt 16:00 (za 7 h 43)    │
│      │                                  │ €18 450   Uszkodzenie ład. 1.2% │
│      │                                  │ ODPOCZYNEK za 3 h 10            │
└──────┴──────────────────────────────────┴─────────────────────────────────┘
```

### 6.5 Toasty

```
            ╭───────────────────────────────────────────╮
            │ ⛽  Niski poziom paliwa                     │  ← pigułka szkła u góry,
            │     Zasięg 94 km · najbliższa stacja w GPS  │    spring wejścia z góry,
            ╰───────────────────────────────────────────╯    critical = czerwony rim + wibracja dźwiękowa
```

## 7. Dotyk i kiosk (wymagania dla shella)

- `touch-action: manipulation` globalnie; `none` na sliderach i sheetach.
- `user-select: none`, blokada `contextmenu`, `-webkit-touch-callout: none`.
- `overscroll-behavior: none` na `html, body`.
- Gesty: tylko tap, long-press (≥ 450 ms), drag na sheetach i sliderach, swipe poziomy między stronami home. **Żadnych gestów od krawędzi ekranu** (konflikt z Windows).
- Feedback naciśnięcia w < 50 ms (stan `:active` CSS + spring), niezależnie od sieci.
