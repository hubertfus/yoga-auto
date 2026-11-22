# e2e — Playwright na mocku (S7)

Scenariusze: połączenie z bridge'em i Home, nawigacja (dock), tapnięcie akcji → `in` do „gry” → zmiana stanu w UI,
zerwanie bridge'a → „brak bridge'a” → automatyczny powrót. `test.fixme`: toast z alertu (czeka na presentery S5)
i parowanie PIN-em (czeka na ekran S4 + bridge z auth).

## Uruchomienie

```powershell
npx playwright test -c e2e          # z korzenia repo (Playwright sam buduje i serwuje aplikację)
npx playwright test -c e2e --headed
```

- **Przeglądarka:** lokalnie na Windows Microsoft Edge (`channel: "msedge"`, nic się nie pobiera). W CI / na Linuksie
  bundlowany Chromium: jednorazowo `npx playwright install chromium`. Nadpisanie: `E2E_CHANNEL=chrome|msedge|chromium`.
- **Porty:** bridge 7423 (startowany w procesie testu — fixture `bridge` w `fixtures.ts`, podsłuchuje wejścia do „gry”),
  Vite preview 5175 (`vite build` + `vite preview`, proxy `/ws` → bridge; `vite dev` pada w F0, zob.
  `docs/proposals/s7-bug-vite-dev-refresh.md`).
- Jeden worker (stały port bridge'a, test reconnect restartuje go na tym samym porcie).
- Artefakty (`test-results/`, `playwright-report/`) są w `e2e/.gitignore`.
