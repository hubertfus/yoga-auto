# Własność katalogów

Agent edytuje **tylko** katalogi swojego strumienia. Potrzebna zmiana gdzie indziej → `docs/proposals/<strumień>-<temat>.md`.

| Ścieżka | Właściciel |
|---|---|
| `shared/protocol/**` | lead |
| `package.json`, `package-lock.json`, `tsconfig*.json`, `vitest.config.ts`, `.gitignore`, `.github/**`, `scripts/**` | lead |
| `docs/**` (poza `docs/proposals/` i `docs/progress/`) | lead |
| `docs/progress/sN.md` | strumień SN (dziennik postępu do przejęcia pracy) |
| `plugin/**` (poza `plugin/generated/`, który generuje `npm run gen`) | S1 |
| `bridge/**` | S2 |
| `packages/glass-ui/**`, `shared/design-tokens/**` | S3 |
| `apps/yoga/src/core/**`, `apps/yoga/src/shell/**`, `apps/yoga/{index.html,vite.config.ts,package.json}`, `apps/yoga/public/**` | S4 |
| `apps/yoga/src/features/**` (poza `media/`, `map/`) | S5 |
| `integrations/media/**`, `apps/yoga/src/features/media/**` | S6 |
| `tools/**` (poza `tools/map/`), `tests/**`, `e2e/**` | S7 |
| `tools/map/**`, `apps/yoga/src/features/map/**` | S8 |

Nowa zależność npm: dopisz ją w `package.json` **swojego** pakietu (`npm install <pkg> -w <workspace>`). Konflikt w `package-lock.json` rozwiązuje lead.

## Porty i zasoby lokalne (sesje działają równolegle na jednym PC)

| Kto | Bridge | Vite / Ladle | Pipe |
|---|---|---|---|
| główny folder (lead, Twoje testy) | 7420 | 5173 | — |
| S1 | 7427 | — | `\.\pipe\yoga-auto` (plugin gry); testy: unikalna nazwa |
| S2 | 7421 (testy: `port: 0`) | — | — |
| S3 | 7426 | Ladle 61003 | — |
| S4 | 7422 | 5174 | — |
| S5 | 7428 | 5176 | — |
| S6 | 7429 | 5177 | — |
| S7 | 7423–7425 (testy: `port: 0`) | 5175 | `\.\pipe\yoga-auto-s7-<pid>` |

Nie zabijaj procesów, których sam nie uruchomiłeś.
