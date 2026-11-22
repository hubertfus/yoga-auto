/**
 * Router ekranów (bez URL — kiosk nie ma paska adresu). Ekrany pochodzą z registry; `home` jest wbudowany.
 * Features mogą nawigować: `navigate("vehicle")`.
 * Właściciel: S4.
 */
import { useSyncExternalStore } from "react";

export const HOME = "home";

let route = HOME;
let prev: string | null = null;
const listeners = new Set<() => void>();

export const getRoute = (): string => route;

export function navigate(id: string): void {
  if (id === route) return;
  prev = route;
  route = id;
  listeners.forEach((l) => l());
}

/** Powrót do poprzedniego ekranu (albo Home). */
export function back(): void {
  navigate(prev && prev !== route ? prev : HOME);
}

export function subscribeRoute(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useRoute(): string {
  return useSyncExternalStore(subscribeRoute, getRoute);
}
