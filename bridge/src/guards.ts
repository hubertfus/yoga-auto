/**
 * Ręczne guardy kształtu ramek (bez Ajv na ścieżce 60 Hz). Sprawdzają tylko to, od czego zależy
 * bridge: obiekt, znane `t`, kluczowe pola poprawnego typu.
 */
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const PLUGIN_TYPES = new Set(["hello", "tel", "cfg", "evt", "input.active", "in.ack", "log"]);

/** Czy `v` ma kształt `IpcFromPlugin` (pole `t` znane, kluczowe pola poprawnego typu). */
export function isIpcFromPlugin(v: unknown): boolean {
  if (!isObj(v) || typeof v["t"] !== "string" || !PLUGIN_TYPES.has(v["t"])) return false;
  switch (v["t"]) {
    case "hello":
      return (
        typeof v["ipc"] === "number" &&
        isObj(v["game"]) &&
        Array.isArray(v["channels"]) &&
        isObj(v["inputs"]) &&
        typeof v["inputEnabled"] === "boolean"
      );
    case "tel":
      return isObj(v["ch"]) && typeof v["frame"] === "number" && typeof v["paused"] === "boolean";
    case "cfg":
      return typeof v["id"] === "string" && (v["attrs"] === null || isObj(v["attrs"]));
    case "evt":
      return typeof v["id"] === "string" && isObj(v["attrs"]);
    case "input.active":
      return typeof v["active"] === "boolean" && typeof v["device"] === "string";
    case "in.ack":
      return typeof v["seq"] === "number" && typeof v["ok"] === "boolean";
    case "log":
      return typeof v["msg"] === "string";
  }
  return false;
}

/** Minimalny kształt wiadomości klienta WS: obiekt z `t: string`. */
export function isClientFrame(v: unknown): v is { t: string } {
  return isObj(v) && typeof v["t"] === "string";
}
