# Tryb kiosku na Yodze

Aplikacja działa na tablecie Lenovo Yoga w trybie kiosku: pełny ekran przeglądarki Edge, bez paska zadań,
bez gestów systemowych i bez możliwości przypadkowego powiększenia, przewijania czy otwarcia menu.
Aplikacja jest serwowana przez bridge na PC, pod adresem `http://pc.local:7420` (port produkcyjny 7420).

## 1. Skrót Edge w trybie kiosku

Uruchomienie Edge w kiosku:

```
msedge.exe --kiosk http://pc.local:7420 --edge-kiosk-type=fullscreen --no-first-run --disable-pinch --overscroll-history-navigation=0
```

Znaczenie flag:

- `--kiosk` - tryb kiosku (bez pasków adresu i kart).
- `--edge-kiosk-type=fullscreen` - pełny ekran, pasek zadań ukryty.
- `--no-first-run` - pomija ekrany pierwszego uruchomienia Edge.
- `--disable-pinch` - blokuje zoom dwoma palcami.
- `--overscroll-history-navigation=0` - wyłącza nawigację wstecz/w przód gestem przeciągnięcia.

Adres `pc.local` można zastąpić stałym adresem IP komputera, jeśli mDNS nie działa w sieci.

## 2. Autostart

1. Utwórz skrót do polecenia z sekcji 1 (PPM na pulpicie → Nowy → Skrót).
2. Otwórz folder autostartu: `Win + R` → wpisz `shell:startup` → Enter.
3. Przenieś skrót do otwartego folderu.

Po zalogowaniu Edge uruchomi się automatycznie w trybie kiosku.

## 3. Gesty krawędziowe Windows

Przeciągnięcie palcem od krawędzi ekranu (np. z prawej) otwiera Centrum powiadomień lub przełącza aplikacje.
Trzeba je wyłączyć, żeby nie przerywały pracy kiosku:

- **Przez rejestr** (wymaga uprawnień administratora): `HKLM\SOFTWARE\Policies\Microsoft\Windows\EdgeUI`,
  wartość `AllowEdgeSwipe` (DWORD) = `0`. Zmiana wymaga wylogowania lub restartu.
- **Przez GPO** (Windows Pro/Enterprise): ustawienie polityki dotyczącej gestów krawędziowych, ustawione na wyłączone.

Zmiany w rejestrze i GPO wykonuje ręcznie administrator; nie są częścią instalacji aplikacji.

## 4. Plan zasilania

Ekran tabletu nie może gasnąć podczas pracy kiosku:

- Plan zasilania: **Ekran → nigdy** oraz **Uśpienie → nigdy** dla trybu zasilania z zasilacza.
- Aplikacja dodatkowo blokuje wygaszanie ekranu przez Screen Wake Lock (`navigator.wakeLock.request('screen')`),
  więc ustawienie w systemie jest zabezpieczeniem, a nie jedynym mechanizmem.
- Tablet powinien być podłączony do zasilacza.

## 5. Blokady w aplikacji

Blokady interakcji (zoom, przewijanie, menu kontekstowe, zaznaczanie tekstu) są realizowane w kodzie
aplikacji w `apps/yoga/src/shell/kiosk.ts`. Nie wymagają ustawień po stronie systemu poza punktami 1-3.

## 6. Checklista ręczna (przed każdym wdrożeniem)

- [ ] Zoom nie działa: pinch dwoma palcami oraz Ctrl + kółko myszy (na klawiaturze).
- [ ] Brak przewijania całej strony, bounce i pull-to-refresh.
- [ ] Długie przytrzymanie nie otwiera menu kontekstowego i nie zaznacza tekstu.
- [ ] Brak paska zadań i brak gestów krawędziowych (sekcja 3).
- [ ] Po restarcie tabletu aplikacja uruchamia się sama w trybie kiosku (sekcja 2).
- [ ] Ekran nie gaśnie po co najmniej 10 minutach bezczynności (sekcja 4).
- [ ] Service worker jest aktywny (w DevTools: Application → Service Workers), aplikacja działa offline po odświeżeniu.
- [ ] Aplikacja jest instalowalna jako PWA (menu Edge → Aplikacje → Zainstaluj tę witrynę jako aplikację).
- [ ] Układ poprawny w orientacji poziomej i pionowej (tryb tabletu Yogi, obrót o 360°).

## 7. Otwarte kwestie

- Assigned Access (prawdziwy tryb kiosku systemu) wymaga Windows Pro/Enterprise; na Windows Home zostaje
  sam skrót z sekcji 2.
- Rozdzielczość ekranu Yogi (1920×1080 lub 1080×1920 w zależności od orientacji) do potwierdzenia na urządzeniu.
