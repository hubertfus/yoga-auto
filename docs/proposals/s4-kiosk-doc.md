Status: **WDROŻONE** przez lead (2026-11-22)

# Propozycja: docs/kiosk.md (do przejęcia przez lead)
Zawartość do spisania: skrót Edge z flagami z ANALYSIS §4.2 (`--kiosk --edge-kiosk-type=fullscreen --app=http://<pc>:7422`), autostart (shell:startup), polityka gestów krawędziowych Windows (wyłączyć w Ustawieniach/GPO), plan zasilania (ekran nigdy nie gaśnie; Wake Lock jest dodatkowo w aplikacji), checklista ręczna: brak zoomu (pinch, Ctrl+kółko), brak scrolla/menu kontekstowego/zaznaczania, SW aktywny, instalowalność PWA.
Kod blokad: `apps/yoga/src/shell/kiosk.ts`.
