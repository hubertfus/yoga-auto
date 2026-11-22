// @vitest-environment jsdom
/** M4: trip B (przełącznik A/B, reset z `which`) i ekran historii zleceń (`/api/jobs`). */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { emptyFullState, type SnapshotMsg } from "@yoga-auto/protocol";
import { client } from "../../core/client.ts";
import { getScreens } from "../../core/registry.ts";
import { resetSettings } from "../../core/settings.ts";
import { store } from "../../core/store.ts";
import "../jobs/index.tsx";
import { fetchJobs, jobResult, routeLabel, type JobsRes } from "../jobs/index.tsx";
import "../trip/index.tsx";
import { resetTrip } from "../trip/index.tsx";

const screenOf = (id: string) => getScreens().find((s) => s.id === id)!.component;

beforeEach(() => {
  store.reset();
  resetSettings();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function withTripB() {
  const s = emptyFullState();
  s.slow.trip = { distance: 12_000, fuelUsed: 4, driveTime: 600, instantConsumption: null, resetAt: 1 };
  (s.slow as unknown as Record<string, unknown>)["tripB"] = { distance: 345_000, fuelUsed: 110, driveTime: 14_000, instantConsumption: null, resetAt: 2 };
  store.apply({ t: "snapshot", seq: 1, ts: 1, state: s } satisfies SnapshotMsg);
}

describe("trip B", () => {
  it("przełącznik pokazuje licznik B niezależnie od A", () => {
    withTripB();
    const Trip = screenOf("trip");
    render(<Trip />);
    expect(screen.getByTestId("trip-stats").textContent).toContain("12");
    fireEvent.click(screen.getByText("Trip B"));
    const txt = screen.getByTestId("trip-stats").textContent ?? "";
    expect(txt).toContain("345");
    expect(screen.getByText("Resetuj trip B")).toBeTruthy();
  });

  it("brak tripB w stanie (stary bridge) nie wywala ekranu", () => {
    const Trip = screenOf("trip");
    render(<Trip />);
    fireEvent.click(screen.getByText("Trip B"));
    expect(screen.getByTestId("trip-screen")).toBeTruthy();
  });

  it("reset B wysyła trip.reset z which:B po potwierdzeniu; reset A bez which", () => {
    const send = vi.spyOn(client, "send").mockReturnValue(true);
    const Trip = screenOf("trip");
    render(<Trip />);
    fireEvent.click(screen.getByText("Trip B"));
    fireEvent.click(screen.getByText("Resetuj trip B"));
    expect(send).not.toHaveBeenCalled(); // pierwsze tapnięcie tylko uzbraja
    fireEvent.click(screen.getByText("Potwierdź reset"));
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0]).toMatchObject({ t: "trip.reset", which: "B" });
    send.mockClear();
    fireEvent.click(screen.getByText("Trip A"));
    fireEvent.click(screen.getByText("Resetuj trip A"));
    fireEvent.click(screen.getByText("Potwierdź reset"));
    expect(send.mock.calls[0]![0]).toMatchObject({ t: "trip.reset" });
    expect(send.mock.calls[0]![0]).not.toHaveProperty("which");
  });

  it("resetTrip('B') zwraca obietnicę", async () => {
    vi.spyOn(client, "send").mockReturnValue(false);
    await expect(resetTrip("B")).resolves.toBeDefined();
  });
});

const JOBS: JobsRes = {
  totals: { count: 2, delivered: 1, cancelled: 1, revenue: 18000, penalties: 500, distanceKm: 820, durationS: 7500 },
  jobs: [
    {
      id: "b", status: "cancelled", cargo: "Meble", mass: 9000, from: { city: "Kraków", company: "X" }, to: { city: "Berlin", company: "Y" },
      income: 7000, revenue: 0, penalty: 500, distanceKm: 600, plannedDistanceKm: 600, cargoDamage: 0, gameMinutes: 0, startedAt: 2_000_000, endedAt: 2_100_000, durationS: 100,
    },
    {
      id: "a", status: "delivered", cargo: "Elektronika", mass: 18000, from: { city: "Wrocław", company: "T" }, to: { city: "Hamburg", company: "L" },
      income: 18450, revenue: 18000, penalty: 0, distanceKm: 820, plannedDistanceKm: 812, cargoDamage: 0.05, gameMinutes: 731, startedAt: 1_000_000, endedAt: 1_300_000, durationS: 7400,
    },
  ],
};

describe("historia zleceń", () => {
  it("helpery", () => {
    expect(routeLabel(JOBS.jobs[1]!)).toBe("Wrocław → Hamburg");
    expect(routeLabel({ from: null, to: null })).toBe("–");
    expect(jobResult(JOBS.jobs[0]!)).toBe(-500);
    expect(jobResult(JOBS.jobs[1]!)).toBe(18000);
  });

  it("ekran pokazuje listę z trasą, ładunkiem, dochodem, dystansem, czasem i sumy", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(JOBS), { status: 200 })));
    const Jobs = screenOf("jobs");
    render(<Jobs />);
    await waitFor(() => expect(screen.getAllByTestId("job-row")).toHaveLength(2));
    const rows = screen.getAllByTestId("job-row").map((r) => r.textContent ?? "");
    expect(rows[1]).toContain("Wrocław → Hamburg");
    expect(rows[1]).toContain("Elektronika");
    expect(rows[1]).toContain("18 000");
    expect(rows[1]).toContain("820");
    expect(rows[0]).toContain("−€500");
    const totals = screen.getByTestId("jobs-totals").textContent ?? "";
    expect(totals).toContain("18 000");
    expect(totals).toContain("anul.");
  });

  it("pusta historia i niedostępny bridge nie crashują", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ jobs: [], totals: { ...JOBS.totals, count: 0 } }), { status: 200 })));
    const Jobs = screenOf("jobs");
    const { unmount } = render(<Jobs />);
    await waitFor(() => expect(screen.getByTestId("jobs-empty")).toBeTruthy());
    unmount();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
    render(<Jobs />);
    await waitFor(() => expect(screen.getByTestId("jobs-unavailable").textContent).toContain("niedostępna"));
  });

  it("fetchJobs: błąd sieci i zły kształt → null", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("net"); }));
    expect(await fetchJobs()).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    expect(await fetchJobs()).toBeNull();
  });

  it("odświeża po evt job.delivered", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify(JOBS), { status: 200 }));
    vi.stubGlobal("fetch", f);
    const Jobs = screenOf("jobs");
    render(<Jobs />);
    await waitFor(() => expect(f).toHaveBeenCalledTimes(1));
    act(() => {
      store.apply({
        t: "event", ts: 1,
        event: { kind: "job.delivered", revenue: 1, earnedXp: 1, cargoDamage: 0, distanceKm: 1, deliveryTime: 1, autoParked: false, autoLoaded: false },
      });
    });
    await waitFor(() => expect(f).toHaveBeenCalledTimes(2), { timeout: 2000 });
  });
});
