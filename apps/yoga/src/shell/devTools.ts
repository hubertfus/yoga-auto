/**
 * Narzędzia deweloperskie (tylko `import.meta.env.DEV`): wymuszanie stanów shella w przeglądarce
 * i lokalny mock HTTP parowania (bridge z --no-auth nigdy nie zamyka WS kodem 4003).
 *   ?dev=pairing    ekran parowania (PIN 123456 przechodzi, inny = invalid_pin)
 *   ?dev=connecting ekran „Łączenie…”
 *   ?dev=gameoff    „Gra nie działa”
 */
export type DevForce = "pairing" | "connecting" | "gameoff" | null;

export function devForce(): DevForce {
  if (!import.meta.env.DEV || typeof location === "undefined") return null;
  const v = new URLSearchParams(location.search).get("dev");
  return v === "pairing" || v === "connecting" || v === "gameoff" ? v : null;
}

export function installDevMocks(): void {
  if (devForce() !== "pairing") return;
  const real = window.fetch.bind(window);
  let attempts = 0;
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.endsWith("/api/pair/start")) {
      attempts = 0;
      return json({ requestId: "dev-req", expiresIn: 120 });
    }
    if (url.endsWith("/api/pair/confirm")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as { pin?: string };
      attempts++;
      if (body.pin === "123456") return json({ ok: true, token: "dev-token" });
      return json({ ok: false, error: attempts >= 5 ? "too_many_attempts" : "invalid_pin" }, 400);
    }
    return real(input, init);
  };
}
