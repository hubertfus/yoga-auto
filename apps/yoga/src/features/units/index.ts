/** Formatery zależne od ustawień + hook `useUnits()` (re-render tylko przy zmianie jednostek). */
import { useSettings } from "../../core/settings.ts";
import type { Units } from "../../core/settings.ts";

export * from "./format.ts";

export const useUnits = (): Units => useSettings((s) => s.units);
