// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { emptyFullState } from "@yoga-auto/protocol";
import { getWidget } from "../../core/registry.ts";
import { store } from "../../core/store.ts";
import "./index.tsx";

beforeEach(() => store.reset());
afterEach(cleanup);

describe("skróty akcji na Home", () => {
  it("cały kafel to jeden przycisk akcji z ikoną i podpisem (nie małe kółko w środku)", () => {
    store.apply({ t: "snapshot", seq: 1, ts: 1, state: emptyFullState() });
    const W = getWidget("sc.beacon")!.component;
    const { container } = render(<W size="1x1" />);
    const buttons = container.querySelectorAll("button");
    expect(buttons).toHaveLength(1);
    const b = buttons[0]!;
    expect(b.getAttribute("data-action")).toBe("lights.beacon");
    expect(b.classList.contains("sc-tile__btn")).toBe(true);
    expect(b.textContent).toContain("Kogut");
    expect(container.querySelector(".sc-tile--action")!.contains(b)).toBe(true);
  });
});
