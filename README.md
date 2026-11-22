# yoga-auto

CarPlay-like ekran do Euro Truck Simulator 2 na laptopie dotykowym (Lenovo Yoga) — telemetria na żywo i sterowanie grą dotykiem, w stylu Liquid Glass.

```
ETS2 ── plugin/yoga_auto.dll ──named pipe──▶ bridge (Node) ──WebSocket/LAN──▶ PWA na Yodze (Edge kiosk)
```

## Szybki start (bez gry)

```powershell
npm install
npm run gen
npm run build:app
npm run dev:bridge      # bridge na mocku → http://localhost:7420
```

Tryb deweloperski UI z hot reload: w drugim terminalu `npm run dev:app` (Vite na :5173, proxy do bridge'a).

Sprawdzenie całości: `npm run check` (generatory + typecheck + testy), `node scripts/smoke.ts` (mock → bridge → WS → komenda).

## Plugin (Windows, VS Build Tools 2026)

```powershell
cd plugin; cmake --preset vs; cmake --build --preset release
```

DLL: `plugin/build/Release/yoga_auto.dll` → `<ETS2>\bin\win_x64\plugins\`.

## Dokumentacja

[ANALYSIS](docs/ANALYSIS.md) · [ARCHITECTURE](docs/ARCHITECTURE.md) · [PROTOCOL](docs/PROTOCOL.md) · [DESIGN](docs/DESIGN.md) · [PLAN](docs/PLAN.md) · [OWNERSHIP](docs/OWNERSHIP.md) · [SETUP](docs/SETUP.md) · briefy: [docs/agents/](docs/agents/)
