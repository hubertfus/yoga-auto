import { ACTIONS } from "@yoga-auto/protocol";
import { expect, test } from "./fixtures.ts";

const badge = (page: import("@playwright/test").Page) => page.locator(".shell").getByText(/ms$|brak bridge'a|gra nie działa/);

test.describe("dashboard na mocku", () => {
  test("łączy się z bridge'em i pokazuje Home z prędkością", async ({ page, bridge }) => {
    await page.goto("/");
    await expect(badge(page)).toHaveText(/\d+ ms|– ms/);
    await expect(page.getByText("km/h").first()).toBeVisible();
    expect(bridge.fromSource.some((m) => m.t === "hello")).toBe(true);
  });

  test("nawigacja: Home → Diagnostyka → Home", async ({ page, bridge: _b }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Diagnostyka" }).click();
    await expect(page.getByText("Akcje (surowe)")).toBeVisible();
    await page.getByRole("button", { name: "Home" }).click();
    await expect(page.getByText("Akcje (surowe)")).toBeHidden();
    await expect(page.getByText("km/h").first()).toBeVisible();
  });

  test("tapnięcie akcji → `in` w bridge'u → zmiana stanu w UI", async ({ page, bridge }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Diagnostyka" }).click();
    const status = page.locator("pre").first();
    await expect(status).toContainText('"lights"');
    const before = await status.innerText();

    await page.getByRole("button", { name: ACTIONS["lights.cycle"].label }).click();

    const scs = ([] as string[]).concat(ACTIONS["lights.cycle"].scs as string | string[]);
    await expect.poll(() => bridge.toSource.some((m) => m.t === "in" && scs.includes(m.input))).toBe(true);
    await expect.poll(async () => status.innerText()).not.toBe(before);
  });

  test("zerwanie bridge'a → „brak bridge'a”, po restarcie UI wraca samo", async ({ page, bridge }) => {
    await page.goto("/");
    await expect(badge(page)).toHaveText(/ms$/);
    await bridge.stop();
    await expect(badge(page)).toHaveText("brak bridge'a", { timeout: 15_000 });
    await bridge.start();
    await expect(badge(page)).toHaveText(/ms$/, { timeout: 30_000 });
  });

  // Wymaga presentera zdarzeń (S5 rejestruje je w apps/yoga/src/features/*) — w F0 nic nie renderuje toastów.
  test.fixme("alert (job.delivered) → toast", async ({ page, bridge }) => {
    await bridge.stop();
    await bridge.start({ scenario: "job-cycle", speed: 30 });
    await page.goto("/");
    await expect(page.getByRole("status").first()).toBeVisible({ timeout: 20_000 });
  });

  // Wymaga ekranu parowania S4 (`/api/pair/*`) i bridge'a z auth: true.
  test.fixme("parowanie PIN-em → token → Home", async () => {});
});
