/** Komputer pokładowy (trip A i B): dystans, czas jazdy, zużycie, średnia prędkość, reset z potwierdzeniem. */
import { useEffect, useRef, useState } from "react";
import { GlassButton, GlassPanel, GlassSegmented, Icon, type SegmentOption } from "@yoga-auto/glass-ui";
import type { ClientMsg, TripState } from "@yoga-auto/protocol";
import { client } from "../../core/client.ts";
import { tripReset, usePending } from "../../core/commands.ts";
import { registerScreen } from "../../core/registry.ts";
import { useSlow } from "../../core/store.ts";
import { CardTitle, Stat } from "../_shared/shared.tsx";
import {
  formatConsumption,
  formatDistance,
  formatDuration,
  formatKm,
  formatSpeed,
  formatVolume,
  speedLabel,
  volumeLabel,
  useUnits,
} from "../units/index.ts";
import type { Units } from "../../core/settings.ts";

/** Średnie zużycie od resetu w l/100 km; null gdy przejechano < 100 m (zbyt mało danych). */
export function averageConsumption(t: Pick<TripState, "distance" | "fuelUsed">): number | null {
  return t.distance >= 100 ? (t.fuelUsed / t.distance) * 100_000 : null;
}

/** Średnia prędkość jazdy (m/s); null bez czasu jazdy. */
export function averageSpeed(t: Pick<TripState, "distance" | "driveTime">): number | null {
  return t.driveTime > 1 ? t.distance / t.driveTime : null;
}

export function TripStats({ trip, u }: { trip: TripState; u: Units }) {
  const avg = averageConsumption(trip);
  const speed = averageSpeed(trip);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "var(--s-5)" }} data-testid="trip-stats">
      <Stat label="Dystans" value={formatDistance(trip.distance, u)} />
      <Stat label="Czas jazdy" value={formatDuration(trip.driveTime)} />
      <Stat label="Średnia prędkość" value={speed === null ? "–" : formatSpeed(speed, u)} unit={speedLabel(u)} />
      <Stat label="Spalone paliwo" value={formatVolume(trip.fuelUsed, u)} unit={volumeLabel(u)} />
      <Stat label="Średnie zużycie" value={formatConsumption(avg, u)} />
      <Stat label="Chwilowe zużycie" value={formatConsumption(trip.instantConsumption, u)} />
    </div>
  );
}

export type TripWhich = "A" | "B";

/** Drugi licznik (M4): bridge dokłada `slow.tripB` (addytywnie, spoza typów kontraktu v1.0). */
export const selectTripB = (s: object): TripState | null => (s as { tripB?: TripState }).tripB ?? null;

/** `trip.reset` z `which` (rozszerzenie M4, patrz docs/proposals/s5-m4-trip-history.md). Stary bridge ignoruje `which` i kasuje A. */
export function resetTrip(which: TripWhich): Promise<unknown> {
  if (which === "A") return tripReset();
  return Promise.resolve(client.send({ t: "trip.reset", id: `tb${Date.now().toString(36)}`, which } as unknown as ClientMsg));
}

const TRIP_OPTIONS: SegmentOption<TripWhich>[] = [
  { value: "A", label: "Trip A" },
  { value: "B", label: "Trip B" },
];

/** Reset z dwustopniowym potwierdzeniem (pierwsze tapnięcie uzbraja przycisk na 3 s). */
function ResetButton({ which }: { which: TripWhich }) {
  const pending = usePending("trip.reset");
  const [armed, setArmed] = useState(false);
  const timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    clearTimeout(timer.current);
    setArmed(false);
  }, [which]);
  return (
    <GlassButton
      size="lg"
      tone={armed ? "crit" : "accent"}
      active={armed}
      pending={which === "A" && pending}
      icon={<Icon name="refresh" />}
      label={armed ? "Potwierdź reset" : `Resetuj trip ${which}`}
      onPress={() => {
        if (!armed) {
          setArmed(true);
          timer.current = window.setTimeout(() => setArmed(false), 3000);
          return;
        }
        clearTimeout(timer.current);
        setArmed(false);
        void resetTrip(which);
      }}
    />
  );
}

function sinceReset(resetAt: number, now: number): string {
  if (!resetAt) return "–";
  return formatDuration(Math.max(0, (now - resetAt) / 1000));
}

const EMPTY_TRIP: TripState = { distance: 0, fuelUsed: 0, driveTime: 0, instantConsumption: null, resetAt: 0 };

function TripScreen() {
  const u = useUnits();
  const [which, setWhich] = useState<TripWhich>("A");
  const tripA = useSlow((s) => s.trip);
  const tripB = useSlow(selectTripB);
  const trip = which === "B" ? (tripB ?? EMPTY_TRIP) : tripA;
  const odometer = useSlow((s) => s.odometer);
  const rangeKm = useSlow((s) => s.fuel.rangeKm);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="ft-screen" data-testid="trip-screen">
      <GlassPanel padding={32} tint="strong">
        <div className="ft-spread">
          <CardTitle icon={<Icon name="clock" size={20} />}>Komputer pokładowy · Trip {which}</CardTitle>
          <GlassSegmented<TripWhich> options={TRIP_OPTIONS} value={which} onChange={setWhich} />
        </div>
        <div style={{ height: "var(--s-5)" }} />
        <TripStats trip={trip} u={u} />
        <div style={{ height: "var(--s-5)" }} />
        <div className="ft-spread">
          <span className="ft-dim">Od resetu minęło {sinceReset(trip.resetAt, now)}</span>
          <ResetButton which={which} />
        </div>
      </GlassPanel>
      <GlassPanel padding={24}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "var(--s-5)" }}>
          <Stat label="Przebieg" value={formatKm(odometer, u)} />
          <Stat label="Zasięg na paliwie" value={formatKm(rangeKm, u)} />
        </div>
      </GlassPanel>
    </div>
  );
}

registerScreen({ id: "trip", label: "Komputer", icon: "activity", order: 50, component: TripScreen });
