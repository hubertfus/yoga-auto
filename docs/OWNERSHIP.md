# Własność katalogów

Agent edytuje **tylko** katalogi swojego strumienia. Potrzebna zmiana gdzie indziej → `docs/proposals/<strumień>-<temat>.md`.

| Ścieżka | Właściciel |
|---|---|
| `shared/protocol/**` | lead |
| `package.json`, `package-lock.json`, `tsconfig*.json`, `vitest.config.ts`, `.gitignore`, `.github/**`, `scripts/**` | lead |
| `docs/**` (poza `docs/proposals/`) | lead |
| `plugin/**` (poza `plugin/generated/`, który generuje `npm run gen`) | S1 |
| `bridge/**` | S2 |
| `packages/glass-ui/**`, `shared/design-tokens/**` | S3 |
| `apps/yoga/src/core/**`, `apps/yoga/src/shell/**`, `apps/yoga/{index.html,vite.config.ts,package.json}`, `apps/yoga/public/**` | S4 |
| `apps/yoga/src/features/**` (poza `media/`, `map/`) | S5 |
| `integrations/media/**`, `apps/yoga/src/features/media/**` | S6 |
| `tools/**` (poza `tools/map/`), `tests/**`, `e2e/**` | S7 |
| `tools/map/**`, `apps/yoga/src/features/map/**` | S8 |

Nowa zależność npm: dopisz ją w `package.json` **swojego** pakietu (`npm install <pkg> -w <workspace>`). Konflikt w `package-lock.json` rozwiązuje lead.
