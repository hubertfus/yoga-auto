/** Zdarzenia gry (jednorazowe). Źródło: gameplay events SDK + zdarzenia wyliczane przez bridge. */

export type GameEvent =
  | { kind: "job.started"; job: import("./state.ts").JobConfig }
  | {
      kind: "job.delivered";
      revenue: number;
      earnedXp: number;
      cargoDamage: number;
      distanceKm: number;
      /** minuty gry */
      deliveryTime: number;
      autoParked: boolean;
      autoLoaded: boolean;
      /** `bus` = koniec kursu autobusowego (`bus_job.delivered`); brak = zlecenie z ładunkiem */
      jobKind?: "cargo" | "bus";
    }
  | { kind: "job.cancelled"; penalty: number; jobKind?: "cargo" | "bus" }
  | { kind: "player.fined"; offence: string; amount: number }
  | { kind: "player.tollgate"; amount: number }
  | { kind: "player.ferry"; source: string; target: string; amount: number }
  | { kind: "player.train"; source: string; target: string; amount: number }
  | { kind: "player.refuel"; amount: number }
  | { kind: "trailer.attached"; index: number }
  | { kind: "trailer.detached"; index: number }
  | { kind: "game.paused" }
  | { kind: "game.resumed" };

export type GameEventKind = GameEvent["kind"];
