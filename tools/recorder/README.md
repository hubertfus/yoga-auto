# recorder — nagrania sesji `.yarec` (S7)

Format: gzip JSONL, jedna linia = `{ts, kind:"ipc"|"ws", msg}` (`ts` w ms od początku). Nagrywa wejście IPC
(da się odtworzyć) i wyjście WS.

## Elementy

- `YarecRecorder` / interfejs `Recorder` — zapis; hook w bridge'u: `docs/proposals/s7-recorder-hook.md`.
- `ReplaySource` (`kind: "replay"`) — `TelemetrySource` odtwarzający nagranie: prędkość 0.1–32 (użytkowo x0.5–x8),
  `loop`, pauza, `seek`; po seek/pętli wysyła spójny stan (hello, cfg, pełny tel). Na `in` odpowiada `in.ack{ok:false}`.
- Próbki syntetyczne z mocka: `samples/highway-60s.yarec`, `city-night-60s.yarec`, `job-cycle-90s.yarec`
  (odtwarzalne przez `npm run samples -w @yoga-auto/recorder`, `src/gen-samples.ts`).
- Prawdziwe nagrania z gry zapisujemy jako `samples/real-*.yarec` (sesja integracyjna).

## CLI `yarec`

```powershell
node tools/recorder/src/cli.ts info  tools/recorder/samples/highway-60s.yarec [--json]
node tools/recorder/src/cli.ts cut   in.yarec --from 10 --to 40 -o out.yarec
node tools/recorder/src/cli.ts speed in.yarec --factor 2 -o out.yarec
node tools/recorder/src/cli.ts gen   --scenario crash --seconds 45 [--seed 1] -o crash.yarec
```

## Użycie w testach

```ts
import { ReplaySource, readYarec } from "@yoga-auto/recorder";
const src = new ReplaySource({ file: "tools/recorder/samples/highway-60s.yarec", speed: 4, loop: true });
```

Odtwarzanie przez pipe: `fake-pipe --replay <plik>` (patrz `tools/fake-pipe/README.md`).
