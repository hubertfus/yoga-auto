Status: **WDROŻONE** przez lead (2026-11-22)

# Propozycja S7 → lead: skrypty w root `package.json`, workspaces, tsconfig

Pliki własności leada (`package.json`, `tsconfig.json`, `vitest.config.ts`, `scripts/**`) — S7 nie może ich zmienić.

## 1. Skrypty (root `package.json`)

```jsonc
"dev:mock":   "node bridge/src/main.ts --source mock --no-auth",            // brak scripts/dev-mock.ts mimo obecnego skryptu → naprawić
"dev:replay": "node tools/fake-pipe/src/cli.ts --replay",                   // npm run dev:replay -- tools/recorder/samples/highway-60s.yarec --loop
"yarec":      "node tools/recorder/src/cli.ts",                             // npm run yarec -- info <plik>
"probe":      "node tools/fake-pipe/src/probe.ts",
"e2e":        "npm run e2e -w @yoga-auto/e2e",
"bench":      "npm run bench -w @yoga-auto/bench"
```

`dev:replay`: dopóki bridge nie ma `--source replay` (zob. `s7-recorder-hook.md`), replay idzie przez pipe:
`fake-pipe --replay F` + `bridge --source pipe --path <ta sama ścieżka>`. Po dodaniu `--source replay` w bridge'u
skrypt może wołać `node bridge/src/main.ts --source replay --file`.

## 2. Workspaces

Dodać do `workspaces`: `"tests"` i `"e2e"` (oba mają własne `package.json`; `tools/*` już jest, więc `tools/bench` wchodzi automatycznie).
Obecnie `tests/**` korzysta z zależności roota — działa, ale `e2e` potrzebuje własnego `@playwright/test`.

## 3. tsconfig

`tsconfig.json` ma `include` bez `tests/**` i `e2e/**` → testy S7 nie są typecheckowane. Proponuję dodać
`"tests/**/*"`, `"e2e/**/*"` (e2e wymaga typów Playwrighta po `npm install`).

## 4. `npm run check`

Test `tests/contract/bridge-mock` trwa 30 s (`CONTRACT_SECONDS`). Ewentualnie osobny skrypt `check:fast` z `CONTRACT_SECONDS=8`.
`vitest.config.ts` już wyklucza `e2e/**` (dobrze: e2e idzie osobnym runnerem Playwright).

## 5. Smoke

`scripts/smoke.ts` można przenieść do `tests/` (własność S7) — do decyzji leada.

Uwagi z wdrożenia: dodano `fake-pipe`; `dev:replay` używa już `bridge --source replay`; do workspaces dodano tylko `e2e` (`tests/` nie ma `package.json`, `tools/bench` wchodzi przez `tools/*`); tsconfig `include` + `tests/**`, `e2e/**`.
