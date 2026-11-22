# Bug (S7 → lead/S4): `vite dev` zwraca 500 „Missing field `moduleType`”

**Repro:** `npm install` (świeży) → `npm run dev -w @yoga-auto/yoga` → każda transformacja `.tsx` kończy się
`Plugin: builtin:vite-react-refresh-wrapper — Missing field moduleType` (strona pusta, w konsoli 500).
`vite build` działa poprawnie (53 modułów).

**Diagnoza:** `apps/yoga/node_modules/vite` = 7.3.8, a w root `node_modules` leży `vite` 8.3.8 + `rolldown` 1.2.19
(z vitest 5.1) i `@vitejs/plugin-react` 5.2.0 — plugin wykrywa rolldown i używa wbudowanego wrappera, który nie
pasuje do vite 7 uruchamianego dev-serverem. Naprawa po stronie lead/S4: ujednolicić wersję vite (np. `vite@^8` w
`apps/yoga` + zgodny plugin-react) albo `overrides`.

**Obejście w e2e:** `e2e/playwright.config.ts` używa `vite build` + `vite preview` (dziedziczy proxy `/ws`).
Po naprawie można wrócić do dev-servera (szybszy HMR nie jest potrzebny w CI).
