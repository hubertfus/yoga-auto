/** Gameplay events SDK (IPC `evt`) → GameEvent. F0: bazowe. S2: komplet + eventy pochodne. */
import type { GameEvent, ipc } from "@yoga-auto/protocol";

type V = ipc.IpcValue;
const n = (v: V | undefined) => (typeof v === "number" ? v : 0);
const s = (v: V | undefined) => (typeof v === "string" ? v : "");
const b = (v: V | undefined) => v === true;

export function mapGameplayEvent(e: ipc.IpcGameplay): GameEvent | null {
  const a = e.attrs;
  switch (e.id) {
    case "job.delivered":
      return {
        kind: "job.delivered",
        revenue: n(a["revenue"]),
        earnedXp: n(a["earned.xp"]),
        cargoDamage: n(a["cargo.damage"]),
        distanceKm: n(a["distance.km"]),
        deliveryTime: n(a["delivery.time"]),
        autoParked: b(a["auto.park.used"]),
        autoLoaded: b(a["auto.load.used"]),
      };
    case "job.cancelled":
      return { kind: "job.cancelled", penalty: n(a["cancel.penalty"]) };
    // kursy autobusowe (SDK 1.20+): atrybuty nieopisane przez SCS — zakładamy nazwy jak przy `job.*`
    case "bus_job.delivered":
      return {
        kind: "job.delivered",
        jobKind: "bus",
        revenue: n(a["revenue"]),
        earnedXp: n(a["earned.xp"]),
        cargoDamage: 0,
        distanceKm: n(a["distance.km"]),
        deliveryTime: n(a["delivery.time"]),
        autoParked: b(a["auto.park.used"]),
        autoLoaded: false,
      };
    case "bus_job.cancelled":
      return { kind: "job.cancelled", jobKind: "bus", penalty: n(a["cancel.penalty"]) };
    case "player.fined":
      return { kind: "player.fined", offence: s(a["fine.offence"]), amount: n(a["fine.amount"]) };
    case "player.tollgate.paid":
      return { kind: "player.tollgate", amount: n(a["pay.amount"]) };
    case "player.use.ferry":
      return {
        kind: "player.ferry",
        source: s(a["source.name"]),
        target: s(a["target.name"]),
        amount: n(a["pay.amount"]),
      };
    case "player.use.train":
      return {
        kind: "player.train",
        source: s(a["source.name"]),
        target: s(a["target.name"]),
        amount: n(a["pay.amount"]),
      };
    case "player.refuel.paid":
      return { kind: "player.refuel", amount: n(a["pay.amount"]) };
    default:
      return null;
  }
}
