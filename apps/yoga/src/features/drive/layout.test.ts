// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_LAYOUT, parseLayout, reloadDriveLayout, resetDriveLayout, toggleIn, toggleLayoutItem, updateDriveLayout } from "./layout.ts";

afterEach(() => {
  localStorage.clear();
  reloadDriveLayout();
});

describe("układ ekranu Jazda", () => {
  it("domyślnie: wszystko widać, skala 0–140, bez przycisków na dole", () => {
    expect(parseLayout(null)).toEqual(DEFAULT_LAYOUT);
    expect(DEFAULT_LAYOUT.actions).toEqual([]);
    expect(DEFAULT_LAYOUT.speedRange).toBe("mid");
  });

  it("naprawa zapisu: zepsuty JSON, nieznane pola i akcje odrzucone, kolejność list stała, akcji wg dodania", () => {
    expect(parseLayout("{zepsute")).toEqual(DEFAULT_LAYOUT);
    const l = parseLayout(
      JSON.stringify({ panel: false, speedRange: "x", gauges: ["odo", "fuel", "nope"], actions: ["retarder.up", "nope", "lights.hazard", "retarder.up"] }),
    );
    expect(l.panel).toBe(false);
    expect(l.telltales).toBe(true);
    expect(l.speedRange).toBe("mid");
    expect(l.gauges).toEqual(["fuel", "odo"]);
    expect(l.actions).toEqual(["retarder.up", "lights.hazard"]);
  });

  it("szybkie przełączanie pod rząd nie gubi zmian; zapis i przywrócenie domyślnych", () => {
    toggleLayoutItem("actions", "lights.hazard");
    toggleLayoutItem("actions", "retarder.up");
    toggleLayoutItem("gauges", "adblue");
    updateDriveLayout({ speedRange: "low" });
    const saved = parseLayout(localStorage.getItem("yoga.drive.layout"));
    expect(saved.actions).toEqual(["lights.hazard", "retarder.up"]);
    expect(saved.gauges).not.toContain("adblue");
    expect(saved.speedRange).toBe("low");
    resetDriveLayout();
    expect(localStorage.getItem("yoga.drive.layout")).toBeNull();
  });

  it("toggleIn dokłada na końcu albo usuwa", () => {
    expect(toggleIn([1, 2], 3)).toEqual([1, 2, 3]);
    expect(toggleIn([1, 2, 3], 2)).toEqual([1, 3]);
  });
});
