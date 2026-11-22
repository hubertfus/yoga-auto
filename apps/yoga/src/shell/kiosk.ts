/**
 * Kiosk: blokady gestów/menu (DESIGN.md §7) i Screen Wake Lock (ANALYSIS.md §4.2).
 * Wszystko w jednym miejscu, żeby `docs/kiosk.md` miał jedno źródło prawdy.
 */
import { releaseAllHolds } from "../core/commands.ts";

type Off = () => void;

const BLOCKED_ZOOM_KEYS = new Set(["+", "-", "=", "_", "0"]);

/** Globalne blokady: zoom (pinch, Ctrl+kółko, Ctrl +/-/0), menu kontekstowe, zaznaczanie, przeciąganie. */
export function installGestureGuards(target: Document = document): Off {
  const off: Off[] = [];
  const on = <K extends keyof DocumentEventMap>(
    type: K,
    fn: (e: DocumentEventMap[K]) => void,
    opts: AddEventListenerOptions = {},
  ) => {
    target.addEventListener(type, fn, opts);
    off.push(() => target.removeEventListener(type, fn, opts));
  };

  on("contextmenu", (e) => e.preventDefault());
  on("selectstart", (e) => e.preventDefault());
  on("dragstart", (e) => e.preventDefault());
  // Safari/Chromium-on-touch: gesty pinch jako zdarzenia gesture*
  for (const t of ["gesturestart", "gesturechange", "gestureend"]) {
    target.addEventListener(t, prevent, { passive: false });
    off.push(() => target.removeEventListener(t, prevent));
  }
  // pinch dwoma palcami (Edge/Chromium) — drugi palec nie może przewijać/zoomować
  on(
    "touchmove",
    (e) => {
      if (e.touches.length > 1) e.preventDefault();
    },
    { passive: false },
  );
  on(
    "touchstart",
    (e) => {
      if (e.touches.length > 1) e.preventDefault();
    },
    { passive: false },
  );
  // Ctrl + kółko (zoom touchpada/pinch jako wheel)
  on(
    "wheel",
    (e) => {
      if (e.ctrlKey) e.preventDefault();
    },
    { passive: false },
  );
  on("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && BLOCKED_ZOOM_KEYS.has(e.key)) e.preventDefault();
  });
  return () => off.forEach((f) => f());
}

function prevent(e: Event) {
  e.preventDefault();
}

interface WakeLockSentinelLike {
  released: boolean;
  release(): Promise<void>;
  addEventListener(type: "release", cb: () => void): void;
}

/**
 * Screen Wake Lock: ekran nie gaśnie. System zwalnia blokadę, gdy karta traci widoczność,
 * więc po `visibilitychange` żądamy ponownie. Zwraca funkcję sprzątającą i getter statusu.
 */
export function installWakeLock(onChange?: (active: boolean) => void): Off {
  const nav = navigator as Navigator & { wakeLock?: { request(type: "screen"): Promise<WakeLockSentinelLike> } };
  if (!nav.wakeLock) {
    onChange?.(false);
    return () => {};
  }
  let sentinel: WakeLockSentinelLike | null = null;
  let disposed = false;

  const request = async () => {
    if (disposed || document.visibilityState !== "visible" || (sentinel && !sentinel.released)) return;
    try {
      const s = await nav.wakeLock!.request("screen");
      if (disposed) {
        void s.release();
        return;
      }
      sentinel = s;
      onChange?.(true);
      s.addEventListener("release", () => {
        if (sentinel === s) sentinel = null;
        onChange?.(false);
      });
    } catch {
      onChange?.(false); // np. tryb oszczędzania baterii — spróbujemy przy kolejnej okazji
    }
  };

  const onVisibility = () => {
    if (document.visibilityState === "visible") void request();
    else releaseAllHolds(); // karta zakryta → żadnych „zawieszonych” klaksonów
  };
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("focus", request);
  // Pierwsze żądanie może wymagać gestu użytkownika — ponawiamy przy pierwszym dotyku.
  document.addEventListener("pointerdown", request, { once: true });
  void request();

  return () => {
    disposed = true;
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("focus", request);
    document.removeEventListener("pointerdown", request);
    void sentinel?.release();
  };
}

/** Puść trzymane akcje także po utracie fokusu/ukryciu strony (np. Alt+Tab na PC kiosku). */
export function installHoldSafety(): Off {
  window.addEventListener("blur", releaseAllHolds);
  window.addEventListener("pagehide", releaseAllHolds);
  return () => {
    window.removeEventListener("blur", releaseAllHolds);
    window.removeEventListener("pagehide", releaseAllHolds);
  };
}
