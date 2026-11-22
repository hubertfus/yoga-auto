# yoga-auto

CarPlay-like ekran do Euro Truck Simulator 2 na laptopie dotykowym (Lenovo Yoga) — telemetria na żywo i sterowanie grą dotykiem, w stylu Liquid Glass.

```
ETS2 ── plugin/yoga_auto.dll ──named pipe──▶ bridge (Node) ──WebSocket/LAN──▶ PWA na Yodze (Edge kiosk)
```

## Jedno polecenie: `yoga.bat`

Dwuklik albo w terminalu w korzeniu repo:

| Polecenie | Co robi |
|---|---|
| `yoga.bat` | `npm install`, generatory, build PWA, build pluginu (CMake z VS Build Tools), kopia `yoga_auto.dll` do ETS2 (autowykrycie przez Steam), reguła zapory TCP 7420 dla sieci prywatnej (pyta o zgodę i admina), adresy dla Yogi, start bridge'a na grze |
| `yoga.bat mock` | to samo bez pluginu, bridge na mocku (`-Scenario city-night` itd.) |
| `yoga.bat replay` | bridge odtwarza nagranie jazdy (`-Replay <plik.yarec>`) |
| `yoga.bat check` | `npm run check` |
| `yoga.bat plugin` | tylko build pluginu i kopia DLL |
| `yoga.bat help` | opcje: `-Ets2Dir`, `-Port`, `-SkipInstall`, `-SkipPlugin`, `-NoFirewall`, `-NoAuth`, `-NoStart` |

Potem na Yodze otwórz w Edge adres wypisany w oknie i wpisz PIN z konsoli PC. Kiosk na stałe: [docs/kiosk.md](docs/kiosk.md). Logika: `scripts/yoga.ps1`.

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
