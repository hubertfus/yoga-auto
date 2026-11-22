# S8 → S5/S4: tło mapy w ekranie `nav`

Ekran `nav` należy do S5 (`features/navigation`), więc S8 go nie edytuje. Obecnie `features/map/index.tsx` po załadowaniu modułów (`setTimeout 0`) pobiera `getScreen("nav")` i rejestruje ten sam ekran owinięty w `<MapView interactive={false}>` pod spodem (registry, addytywnie). To działa, ale jest zależne od kolejności ładowania.
Czystsze docelowo (do decyzji S5/lead): `NavScreen` sam renderuje `import { MapBackground } from "../map/MapBackground.tsx"`, a S8 dostarcza ten komponent; wtedy usuwamy owijanie. Do tego czasu nic nie trzeba robić.
Uwaga wizualna: panele `GlassPanel tint="clear"` na ekranie nav prawie w całości zasłaniają mapę — jeśli ma być czytelna, panele powinny być węższe lub mapa po prawej stronie.
