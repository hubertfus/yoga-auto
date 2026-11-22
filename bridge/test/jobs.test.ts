import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { IPC_VERSION, emptyFullState, type JobConfig, type SourceMsg, type TelemetrySource, type ipc } from "@yoga-auto/protocol";
import { FileJobStorage, JobHistory, MemoryJobStorage, totalsOf } from "../src/jobs.ts";
import { DeviceStore } from "../src/devices.ts";
import { FileTripStorage, MemoryTripStorage, TripComputer } from "../src/trip.ts";
import { startBridge } from "../src/server.ts";
import { TestClient, sleep } from "./ws-client.ts";

const job = (over: Partial<JobConfig> = {}): JobConfig => ({
  cargo: "Elektronika",
  cargoId: "electronics",
  mass: 18000,
  income: 18450,
  deliveryTime: 1000,
  plannedDistanceKm: 812,
  source: { city: "Wrocław", cityId: "wroclaw", company: "Tradeaux", companyId: "tradeaux" },
  destination: { city: "Hamburg", cityId: "hamburg", company: "LKW", companyId: "lkw" },
  market: "freight_market",
  special: false,
  cargoLoaded: false,
  ...over,
});
const delivered = {
  kind: "job.delivered",
  revenue: 18000,
  earnedXp: 700,
  cargoDamage: 0.05,
  distanceKm: 820,
  deliveryTime: 731,
  autoParked: false,
  autoLoaded: false,
} as const;

describe("JobHistory", () => {
  it("dostarczone zlecenie: trasa, ładunek, dochód, dystans, czas", () => {
    const st = new MemoryJobStorage();
    const h = new JobHistory(st);
    h.onJob(job(), 1_000_000);
    h.onJob(job({ cargoLoaded: true }), 1_060_000); // ten sam ładunek: nie nowe zlecenie
    const r = h.onEvent(delivered, 1_300_000)!;
    h.onJob(null, 1_300_100); // zerowanie configu po evt: bez dodatkowego wpisu
    expect(st.records).toHaveLength(1);
    expect(r).toMatchObject({
      status: "delivered",
      cargo: "Elektronika",
      from: { city: "Wrocław" },
      to: { city: "Hamburg" },
      income: 18450,
      revenue: 18000,
      distanceKm: 820,
      cargoDamage: 0.05,
      gameMinutes: 731,
      startedAt: 1_000_000,
      durationS: 300,
    });
  });

  it("anulowane zlecenie: kara, planowany dystans", () => {
    const st = new MemoryJobStorage();
    const h = new JobHistory(st);
    h.onJob(job(), 0);
    const r = h.onEvent({ kind: "job.cancelled", penalty: 1200 }, 5000)!;
    expect(r).toMatchObject({ status: "cancelled", penalty: 1200, revenue: 0, distanceKm: 812, durationS: 5 });
  });

  it("evt bez znanego configu (start bridge'a w trakcie) też zapisuje; inne eventy ignoruje", () => {
    const h = new JobHistory(new MemoryJobStorage());
    expect(h.onEvent({ kind: "player.refuel", amount: 10 })).toBeNull();
    expect(h.onEvent(delivered)).toMatchObject({ status: "delivered", cargo: "", from: null });
  });

  it("sumy i kolejność (najnowsze pierwsze), limit", () => {
    const h = new JobHistory(new MemoryJobStorage());
    for (let i = 0; i < 3; i++) {
      h.onJob(job({ cargoId: `c${i}` }), i * 1000);
      h.onEvent(i === 1 ? { kind: "job.cancelled", penalty: 100 } : delivered, i * 1000 + 600);
    }
    const all = h.list();
    expect(all.totals).toMatchObject({ count: 3, delivered: 2, cancelled: 1, revenue: 36000, penalties: 100, distanceKm: 1640 });
    expect(h.list(2).jobs).toHaveLength(2);
    expect(h.list(2).jobs[0]!.endedAt).toBeGreaterThan(h.list(2).jobs[1]!.endedAt);
    expect(totalsOf([]).count).toBe(0);
  });

  describe("plik jobs.jsonl", () => {
    let dir = "";
    afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));
    it("zapis przeżywa restart, zepsuta linia jest pomijana", () => {
      dir = mkdtempSync(join(tmpdir(), "yoga-jobs-"));
      const h = new JobHistory(new FileJobStorage(dir));
      h.onJob(job(), 0);
      h.onEvent(delivered, 1000);
      const file = join(dir, "jobs.jsonl");
      expect(readFileSync(file, "utf8").trim().split("\n")).toHaveLength(1);
      new FileJobStorage(dir).append({ ...h.list().jobs[0]!, id: "x2" });
      appendFileSync(file, "{nie json\n");
      expect(new JobHistory(new FileJobStorage(dir)).list().jobs).toHaveLength(2);
    });
  });
});

describe("trip B niezależny od trip A", () => {
  it("osobne storage i reset jednego nie rusza drugiego", () => {
    const s = emptyFullState("mock");
    s.status.connected = true;
    s.slow.odometer = 1000;
    s.slow.fuel.amount = 500;
    let now = 1_000_000;
    const a = new TripComputer(new MemoryTripStorage(), () => now);
    const b = new TripComputer(new MemoryTripStorage(), () => now);
    a.update(s, now);
    b.update(s, now);
    for (let i = 0; i < 40; i++) {
      now += 250;
      s.slow.odometer += 0.005;
      s.fast.speed = 20;
      a.update(s, now);
      b.update(s, now);
    }
    const dist = b.state.distance;
    expect(dist).toBeGreaterThan(150);
    a.reset(now);
    expect(a.state.distance).toBe(0);
    expect(b.state.distance).toBe(dist);
  });

  it("FileTripStorage z sufiksem używa osobnych plików", () => {
    const dir = mkdtempSync(join(tmpdir(), "yoga-tripb-"));
    try {
      expect(new FileTripStorage(dir, "b").currentFile.endsWith("trip-current-b.json")).toBe(true);
      expect(new FileTripStorage(dir, "b").historyFile.endsWith("trips-b.jsonl")).toBe(true);
      expect(new FileTripStorage(dir).historyFile.endsWith("trips.jsonl")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/** Źródło sterowane z testu: hello + cfg/evt na żądanie. */
class ScriptSource implements TelemetrySource {
  readonly kind = "mock" as const;
  private h: ((m: SourceMsg) => void) | null = null;
  async start() {}
  async stop() {}
  send() {}
  onMessage(h: (m: SourceMsg) => void) {
    this.h = h;
    return () => (this.h = null);
  }
  emit(m: SourceMsg) {
    this.h?.(m);
  }
  hello() {
    this.emit({
      t: "hello",
      ipc: IPC_VERSION,
      plugin: { name: "yoga-auto", version: "t" },
      game: { id: "eut2", name: "ETS2", version: "1.50" },
      api: { telemetry: "1.18", input: null },
      channels: [],
      inputs: { semantical: [], generic: [] },
      inputEnabled: false,
    } satisfies ipc.IpcHello);
  }
}

const JOB_ATTRS = {
  "cargo.id": "electronics",
  cargo: "Elektronika",
  "cargo.mass": 18000,
  income: 18450,
  "delivery.time": 1000,
  "planned_distance.km": 812,
  "source.city.id": "wroclaw",
  "source.city": "Wrocław",
  "source.company.id": "tradeaux",
  "source.company": "Tradeaux",
  "destination.city.id": "hamburg",
  "destination.city": "Hamburg",
  "destination.company.id": "lkw",
  "destination.company": "LKW",
  "job.market": "freight_market",
  "is.cargo.loaded": true,
  "special.job": false,
};

describe("bridge: GET /api/jobs i trip.reset which:B", () => {
  const open: { close(): unknown }[] = [];
  afterEach(async () => {
    for (const o of open.splice(0).reverse()) await o.close();
  });

  it("zlecenie z cfg+evt trafia do /api/jobs z sumami", async () => {
    const src = new ScriptSource();
    const b = await startBridge({ source: src, port: 0, host: "127.0.0.1", auth: false, log: () => {} });
    open.push(b);
    src.hello();
    src.emit({ t: "cfg", id: "job", attrs: JOB_ATTRS });
    src.emit({
      t: "evt",
      id: "job.delivered",
      attrs: { revenue: 18000, "earned.xp": 700, "cargo.damage": 0.02, "distance.km": 820, "delivery.time": 731 },
    });
    src.emit({ t: "cfg", id: "job", attrs: null });
    src.emit({ t: "cfg", id: "job", attrs: JOB_ATTRS });
    src.emit({ t: "evt", id: "job.cancelled", attrs: { "cancel.penalty": 500 } });
    const res = await fetch(`http://127.0.0.1:${b.port}/api/jobs`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { jobs: { status: string; cargo: string }[]; totals: Record<string, number> };
    expect(body.jobs.map((j) => j.status)).toEqual(["cancelled", "delivered"]);
    expect(body.jobs[1]).toMatchObject({ cargo: "Elektronika" });
    expect(body.totals).toMatchObject({ count: 2, delivered: 1, cancelled: 1, revenue: 18000, penalties: 500, distanceKm: 820 });
    const lim = (await (await fetch(`http://127.0.0.1:${b.port}/api/jobs?limit=1`)).json()) as { jobs: unknown[] };
    expect(lim.jobs).toHaveLength(1);
  });

  it("z auth bez tokenu: 401", async () => {
    const dir = mkdtempSync(join(tmpdir(), "yoga-jobs-auth-"));
    const b = await startBridge({ source: new ScriptSource(), port: 0, host: "127.0.0.1", auth: true, devices: new DeviceStore(dir), log: () => {} });
    open.push({
      close: async () => {
        await b.close();
        rmSync(dir, { recursive: true, force: true });
      },
    });
    expect((await fetch(`http://127.0.0.1:${b.port}/api/jobs`)).status).toBe(401);
  });

  it("trip.reset z which:B kasuje tylko B; bez which kasuje A", async () => {
    const b = await startBridge({ source: new ScriptSource(), port: 0, host: "127.0.0.1", auth: false, log: () => {} });
    open.push(b);
    const c = new TestClient(b.port);
    open.push(c);
    await c.opened();
    const snap = await c.next("snapshot");
    type Slow = { trip: { resetAt: number }; tripB: { resetAt: number } };
    const slow = snap.state.slow as unknown as Slow;
    expect(slow.tripB).toBeDefined();
    const a0 = slow.trip.resetAt;
    const b0 = slow.tripB.resetAt;
    await sleep(15);
    c.send({ t: "trip.reset", id: "r1", which: "B" } as never);
    await c.next("ack", 3000, (m) => m.id === "r1");
    const st = b.store.state.slow as unknown as Slow;
    expect(st.trip.resetAt).toBe(a0);
    expect(st.tripB.resetAt).toBeGreaterThan(b0);
    await sleep(15);
    c.send({ t: "trip.reset", id: "r2" });
    await c.next("ack", 3000, (m) => m.id === "r2");
    expect((b.store.state.slow as unknown as Slow).trip.resetAt).toBeGreaterThan(a0);
  });
});
