// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cameraBearing, cameraStep, loadViewMode, saveViewMode, TILT_PITCH } from "./camera.ts";

describe("kamera mapy: kierunek jazdy w górę i 3D", () => {
  afterEach(() => localStorage.clear());

  it("tryb zapamiętany per klucz; brak/uszkodzony wpis = północ w górę, 2D", () => {
    expect(loadViewMode("home")).toEqual({ headingUp: false, tilt: false });
    saveViewMode("home", { headingUp: true, tilt: true });
    expect(loadViewMode("home")).toEqual({ headingUp: true, tilt: true });
    expect(loadViewMode("nav")).toEqual({ headingUp: false, tilt: false });
    localStorage.setItem("yoga.map.view.nav", "{zepsute");
    expect(loadViewMode("nav")).toEqual({ headingUp: false, tilt: false });
    expect(loadViewMode(undefined)).toEqual({ headingUp: false, tilt: false });
  });

  it("przejście płynne i domyka się dokładnie na celu", () => {
    let cam = { blend: 0, pitch: 0 };
    cam = cameraStep(cam, { headingUp: true, tilt: true }, 1 / 60);
    expect(cam.blend).toBeGreaterThan(0);
    expect(cam.blend).toBeLessThan(0.5);
    expect(cam.pitch).toBeGreaterThan(0);
    for (let i = 0; i < 120; i++) cam = cameraStep(cam, { headingUp: true, tilt: true }, 1 / 60);
    expect(cam).toEqual({ blend: 1, pitch: TILT_PITCH });
    for (let i = 0; i < 120; i++) cam = cameraStep(cam, { headingUp: false, tilt: false }, 1 / 60);
    expect(cam).toEqual({ blend: 0, pitch: 0 });
  });

  it("obrót najkrótszą drogą od północy: 350° przy połowie przejścia = 355°, nie 175°", () => {
    expect(cameraBearing(90, 1)).toBeCloseTo(90);
    expect(cameraBearing(90, 0)).toBeCloseTo(0);
    expect(cameraBearing(350, 0.5)).toBeCloseTo(355);
    expect(cameraBearing(-30, 1)).toBeCloseTo(330);
  });
});
