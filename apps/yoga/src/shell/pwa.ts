/**
 * Rejestracja service workera (vite-plugin-pwa, generateSW).
 * Dev: SW wyłączony (devOptions.enabled=false), a `virtual:pwa-register` jest wtedy no-op.
 */
import { registerSW } from "virtual:pwa-register";

export function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;
  registerSW({
    immediate: true,
    onRegisterError: (e: unknown) => console.warn("yoga-auto: service worker nie zarejestrowany", e),
  });
}
