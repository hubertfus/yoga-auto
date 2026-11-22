/**
 * Sztuczne obciążenie do testów auto-degradacji: `?burn=1` (domyślnie 20 ms/klatkę) lub `?burn=<ms>`.
 * Blokuje wątek główny w każdej klatce, więc p95 przekracza progi nawet na szybkim GPU.
 */
export function parseBurn(search: string): number {
  const v = new URLSearchParams(search).get("burn");
  if (v === null) return 0;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n === 1 ? 20 : Math.min(n, 100);
}

export function startBurn(msPerFrame: number): () => void {
  let raf = 0;
  let on = true;
  const tick = () => {
    if (!on) return;
    const end = performance.now() + msPerFrame;
    while (performance.now() < end) {
      /* busy */
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => {
    on = false;
    cancelAnimationFrame(raf);
  };
}

/** `?perf=1` włącza overlay diagnostyczny. */
export function wantsOverlay(search: string): boolean {
  const v = new URLSearchParams(search).get("perf");
  return v !== null && v !== "0" && v !== "false";
}
