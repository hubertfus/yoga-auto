// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { GlassButton, GlassCard, LONG_PRESS_MS } from "../src/index.ts";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("GlassCard", () => {
  it("przytrzymanie kafla wywołuje onLongPress i NIE klika przycisku w środku; zwykły tap klika", () => {
    vi.useFakeTimers();
    const onLong = vi.fn();
    const onBtn = vi.fn();
    const { container } = render(
      <GlassCard onLongPress={onLong}>
        <GlassButton label="Kogut" onPress={onBtn} />
      </GlassCard>,
    );
    const b = container.querySelector("button")!;
    fireEvent.pointerDown(b, { pointerId: 1, button: 0, clientX: 10, clientY: 10 });
    act(() => void vi.advanceTimersByTime(LONG_PRESS_MS + 10));
    fireEvent.pointerUp(b, { pointerId: 1 });
    fireEvent.click(b);
    expect(onLong).toHaveBeenCalledTimes(1);
    expect(onBtn).not.toHaveBeenCalled();

    fireEvent.pointerDown(b, { pointerId: 2, button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(b, { pointerId: 2 });
    fireEvent.click(b);
    expect(onBtn).toHaveBeenCalledTimes(1);
  });
});
