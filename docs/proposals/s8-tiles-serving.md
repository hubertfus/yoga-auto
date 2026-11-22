# S8 → S2: serwowanie /tiles (bridge)

Aplikacja (`apps/yoga/src/features/map/tiles.ts`) żąda:
- `GET /tiles/europe.pmtiles?k=<token>` — **z obsługą `Range`** (206, `Accept-Ranges: bytes`, `Content-Range`), `Content-Type: application/octet-stream`; plik tysięcy razy czytany małymi zakresami, więc bez ładowania całości do pamięci (`createReadStream({start,end})`).
- `GET /tiles/projection.json?k=<token>` — mały JSON (kalibracja projekcji, `Content-Type: application/json`); 404 gdy brak (aplikacja przejdzie na parametry domyślne i pokaże, że brak kafli).
Gdy `europe.pmtiles` nie ma: **404** (nie fallback na index.html) — aplikacja pokazuje „brak kafli”.

Katalog kafli: proponuję `%APPDATA%\yoga-auto\tiles\` (+ opcja `--tiles <dir>` / config `tilesDir`); `tools/map` zapisuje wynik w `tools/map/out/`, użytkownik kopiuje.
Auth jak reszta (`?k=`), plus filtr adresów źródłowych jak w PROTOCOL §6. Vite proxy `/tiles` już istnieje.
Bez bridge'a zmian aplikacja i tak działa (mapa pusta + marker).
