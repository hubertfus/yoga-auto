// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { GlassButton } from "../src/index.ts";

afterEach(cleanup);

describe("GlassButton", () => {
  it("onPress na klik; disabled blokuje", () => {
    const onPress = vi.fn();
    const { rerender } = render(<GlassButton label="Mijania" onPress={onPress} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onPress).toHaveBeenCalledTimes(1);
    rerender(<GlassButton label="Mijania" onPress={onPress} disabled />);
    fireEvent.click(screen.getByRole("button"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("pointerdown ustawia data-pressed synchronicznie (<50 ms), pointerup zdejmuje", () => {
    render(<GlassButton label="X" onPress={() => {}} />);
    const b = screen.getByRole("button");
    fireEvent.pointerDown(b, { pointerId: 1, button: 0 });
    expect(b.hasAttribute("data-pressed")).toBe(true);
    fireEvent.pointerUp(b, { pointerId: 1 });
    expect(b.hasAttribute("data-pressed")).toBe(false);
  });

  it("active i pending wystawiają atrybuty stanu", () => {
    render(<GlassButton label="X" active pending onPress={() => {}} />);
    const b = screen.getByRole("button");
    expect(b.getAttribute("aria-pressed")).toBe("true");
    expect(b.getAttribute("aria-busy")).toBe("true");
    expect(b.hasAttribute("data-pending")).toBe(true);
    expect(b.hasAttribute("data-active")).toBe(true);
  });

  it("hold: start na pointerdown z pointer capture, end dokładnie raz", () => {
    const start = vi.fn();
    const end = vi.fn();
    render(<GlassButton label="Klakson" onHoldStart={start} onHoldEnd={end} />);
    const b = screen.getByRole("button");
    const capture = vi.fn();
    (b as HTMLElement).setPointerCapture = capture;
    fireEvent.pointerDown(b, { pointerId: 7, button: 0 });
    expect(start).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith(7);
    fireEvent.pointerUp(b, { pointerId: 7 });
    fireEvent.pointerCancel(b, { pointerId: 7 });
    fireEvent.lostPointerCapture(b, { pointerId: 7 });
    expect(end).toHaveBeenCalledTimes(1);
  });

  it("hold: pointercancel zwalnia, odmontowanie w trakcie trzymania zwalnia", () => {
    const start = vi.fn();
    const end = vi.fn();
    const { unmount } = render(<GlassButton label="K" onHoldStart={start} onHoldEnd={end} />);
    const b = screen.getByRole("button");
    fireEvent.pointerDown(b, { pointerId: 1, button: 0 });
    fireEvent.pointerCancel(b, { pointerId: 1 });
    expect(end).toHaveBeenCalledTimes(1);
    fireEvent.pointerDown(b, { pointerId: 2, button: 0 });
    unmount();
    expect(end).toHaveBeenCalledTimes(2);
  });

  it("hold: ukrycie karty zwalnia przycisk", () => {
    const end = vi.fn();
    render(<GlassButton label="K" onHoldStart={() => {}} onHoldEnd={end} />);
    fireEvent.pointerDown(screen.getByRole("button"), { pointerId: 1, button: 0 });
    Object.defineProperty(document, "hidden", { value: true, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(document, "hidden", { value: false, configurable: true });
    expect(end).toHaveBeenCalledTimes(1);
  });
});
