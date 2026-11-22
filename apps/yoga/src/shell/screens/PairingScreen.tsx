/**
 * Parowanie PIN-em (PROTOCOL.md §6): POST /api/pair/start → PIN na PC → klawiatura 6 cyfr →
 * POST /api/pair/confirm → token do localStorage → reconnect WS.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { GlassButton, GlassPanel } from "@yoga-auto/glass-ui";
import type { PairConfirmRes } from "@yoga-auto/protocol";
import { client, setToken } from "../../core/client.ts";
import { deviceName, pairConfirm, pairStart } from "../../core/pairing.ts";

export const PIN_LENGTH = 6;

type Phase = "starting" | "entry" | "confirming" | "done" | "unreachable";

const ERROR_TEXT: Record<NonNullable<PairConfirmRes["error"]>, string> = {
  invalid_pin: "Niepoprawny PIN. Spróbuj ponownie.",
  expired: "PIN wygasł. Wygenerowałem nowy — sprawdź go na komputerze.",
  too_many_attempts: "Za dużo prób. Wygenerowałem nowy PIN na komputerze.",
};

export function PairingScreen() {
  const [phase, setPhase] = useState<Phase>("starting");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const requestId = useRef<string | null>(null);
  const busy = useRef(false);

  const start = useCallback(async (message?: string) => {
    setPhase("starting");
    setPin("");
    try {
      const r = await pairStart();
      requestId.current = r.requestId;
      setExpiresAt(Date.now() + r.expiresIn * 1000);
      setError(message ?? null);
      setPhase("entry");
    } catch {
      setPhase("unreachable");
    }
  }, []);

  useEffect(() => {
    void start();
  }, [start]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);

  const confirm = useCallback(
    async (code: string) => {
      if (busy.current || !requestId.current) return;
      busy.current = true;
      setPhase("confirming");
      try {
        const r = await pairConfirm({ requestId: requestId.current, pin: code, deviceName: deviceName() });
        if (r.ok && r.token) {
          setToken(r.token);
          setPhase("done");
          client.reconnect();
          return;
        }
        const err = r.error ?? "invalid_pin";
        if (err === "invalid_pin") {
          setPin("");
          setError(ERROR_TEXT.invalid_pin);
          setPhase("entry");
        } else {
          await start(ERROR_TEXT[err]);
        }
      } catch {
        setPhase("unreachable");
      } finally {
        busy.current = false;
      }
    },
    [start],
  );

  const press = (d: string) => {
    if (phase !== "entry" || pin.length >= PIN_LENGTH) return;
    const next = pin + d;
    setPin(next);
    setError(null);
    if (next.length === PIN_LENGTH) void confirm(next);
  };
  const back = () => phase === "entry" && setPin((p) => p.slice(0, -1));

  const secondsLeft = expiresAt ? Math.max(0, Math.ceil((expiresAt - now) / 1000)) : null;
  const expired = phase === "entry" && secondsLeft === 0;

  return (
    <div className="center-screen">
      <GlassPanel className="pair-card">
        <div className="pair-info">
          <h1 className="center-title">Sparuj z komputerem</h1>
          {phase === "unreachable" ? (
            <>
              <p className="center-hint">Nie mogę połączyć się z bridge'em, żeby rozpocząć parowanie.</p>
              <GlassButton size="lg" label="Spróbuj ponownie" onPress={() => void start()} />
            </>
          ) : (
            <>
              <p className="center-hint">
                Na komputerze (konsola bridge'a albo ikona w zasobniku) wyświetla się 6-cyfrowy PIN. Wpisz go tutaj.
              </p>
              <div className="pin" data-error={error ? true : undefined} aria-live="polite" aria-label="PIN">
                {Array.from({ length: PIN_LENGTH }, (_, i) => (
                  <span key={i} className="pin__slot" data-filled={i < pin.length || undefined}>
                    {pin[i] ?? ""}
                  </span>
                ))}
              </div>
              <p className="pair-status" data-error={error ? true : undefined} role="status">
                {phase === "confirming" || phase === "starting"
                  ? "Sprawdzam…"
                  : phase === "done"
                    ? "Sparowano! Łączę…"
                    : expired
                      ? "PIN wygasł."
                      : (error ?? (secondsLeft != null ? `PIN ważny jeszcze ${secondsLeft} s` : ""))}
              </p>
              {expired ? <GlassButton size="lg" label="Nowy PIN" onPress={() => void start()} /> : null}
            </>
          )}
        </div>
        {phase !== "unreachable" ? (
          <div className="keypad" role="group" aria-label="Klawiatura PIN">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
              <GlassButton key={d} size="xl" label={d} disabled={phase !== "entry"} onPress={() => press(d)} />
            ))}
            <span />
            <GlassButton size="xl" label="0" disabled={phase !== "entry"} onPress={() => press("0")} />
            <GlassButton
              size="xl"
              label="⌫"
              aria-label="Usuń cyfrę"
              disabled={phase !== "entry" || pin.length === 0}
              onPress={back}
            />
          </div>
        ) : null}
      </GlassPanel>
    </div>
  );
}
