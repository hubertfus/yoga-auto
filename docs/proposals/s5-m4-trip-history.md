# S5 M4: trip B i historia zleceń: zmiany kontraktu

Status: propozycja do wprowadzenia przez lead'a przy merge'u. Kod S5/bridge działa **bez** tych zmian
(rozszerzenia są addytywne i kompatybilne wstecz), więc zmiany w `shared/protocol` tylko formalizują typy.

## Co zrobiono w kodzie (bez edycji `shared/protocol`)

- **Trip B:** drugi `TripComputer` w bridge'u (osobne pliki `trip-current-b.json`, `trips-b.jsonl`), dostępny jako
  dodatkowe pole `slow.tripB` (ten sam kształt `TripState`). Płynie zwykłym kanałem `slow` (delty i `snapshot`).
  Klient ze starego kontraktu ignoruje nieznane pole.
- **Reset B:** `trip.reset` z dodatkowym polem `which: "A" | "B"`. Brak `which` = `"A"` (stare zachowanie).
- **Historia zleceń:** bridge zapisuje zakończone (`job.delivered`) i anulowane (`job.cancelled`) zlecenia do
  `jobs.jsonl` w katalogu danych, a `GET /api/jobs?limit=N` (domyślnie 200, maks. 1000, wymaga tokenu jak reszta
  zasobów) zwraca `{ jobs: JobRecord[], totals: JobTotals }`, najnowsze pierwsze. UI odświeża listę po evt.
  Brak nowych wiadomości WS.

## Proponowany diff `shared/protocol`

### `state.ts`

```diff
 export interface SlowState {
   ...
   /** Dane wyliczane przez bridge (komputer pokładowy). */
   trip: TripState;
+  /** Drugi licznik (trip B), kasowany osobno (`trip.reset` z `which: "B"`). Opcjonalny: starszy bridge go nie wysyła. */
+  tripB?: TripState;
 }
```

(Po tej zmianie `emptySlow()` w `defaults.ts` powinno zwracać `tripB: emptyTrip(0)` albo zostawić pole
nieustawione. Bridge i tak ustawia je zawsze. Do `SLOW_THRESHOLDS` w bridge'u dodałem już `tripB.*`.)

### `messages.ts`

```diff
 /** Reset komputera pokładowego. */
 export interface TripResetMsg {
   t: "trip.reset";
   id: string;
+  /** Który licznik (domyślnie "A"). */
+  which?: "A" | "B";
 }
```

### Nowe typy (np. `jobs.ts`, eksport z `index.ts`): odpowiedź `GET /api/jobs`

```ts
export interface JobRecord {
  id: string;
  status: "delivered" | "cancelled";
  cargo: string;
  /** kg */
  mass: number;
  from: { city: string; company: string } | null;
  to: { city: string; company: string } | null;
  /** zaplanowany dochód ze zlecenia (waluta gry) */
  income: number;
  /** faktyczny przychód (delivered), 0 przy anulowaniu */
  revenue: number;
  /** kara za anulowanie */
  penalty: number;
  /** km: przejechane (delivered, z gry) albo planowane (cancelled) */
  distanceKm: number;
  plannedDistanceKm: number;
  /** 0..1 */
  cargoDamage: number;
  /** minuty gry zużyte na dostawę (delivered) */
  gameMinutes: number;
  /** ms epoch bridge'a */
  startedAt: number;
  endedAt: number;
  /** s rzeczywiste */
  durationS: number;
}
export interface JobTotals {
  count: number; delivered: number; cancelled: number;
  revenue: number; penalties: number; distanceKm: number; durationS: number;
}
export interface JobsRes { jobs: JobRecord[]; totals: JobTotals }
```

`InfoRes`/`hello.capabilities`: opcjonalnie flaga `jobs: true`, żeby UI mogło ukryć ekran przy starszym bridge'u
(na razie UI sprawdza 404/zły kształt i pokazuje „Historia niedostępna”).

### Dokumentacja (`docs/PROTOCOL.md`)

- §3: `slow.tripB`; §4 / `trip.reset`: pole `which`; §6 (HTTP): `GET /api/jobs?limit=N` (auth jak `/media/art/`).
- JSON Schema (`shared/protocol/schema`) wymaga regeneracji (`npm run gen`) po zmianie typów. Fixture'y bez `tripB`
  pozostają poprawne, bo pole jest opcjonalne.

## Po stronie bridge'a/UI przy wdrożeniu

Po dodaniu typów można usunąć rzutowania `as keyof SlowState` / `as never` w `bridge/src/server.ts` (`setTripB`),
`(msg as { which?: unknown })` w obsłudze `trip.reset` oraz `selectTripB` i `as unknown as ClientMsg` w
`apps/yoga/src/features/trip/index.tsx`. Typy `JobRecord`/`JobTotals`/`JobsRes` z `bridge/src/jobs.ts` i
`features/jobs/index.tsx` zastąpić importem z protokołu.

## Uwagi

- `main.ts` wcześniej nie podawał `tripStorage`, więc trip A nie był trwały w uruchomieniu CLI. Teraz oba liczniki
  i historia zleceń używają `FileTripStorage`/`FileJobStorage` w katalogu danych (to zmiana zachowania `main.ts`).
- `evt job.delivered` przychodzi przed wyzerowaniem `config.job`. Wpis łączy `config.job` (trasa, ładunek) z evt
  (przychód, dystans, uszkodzenie). Jeśli bridge wystartował w trakcie zlecenia, config przychodzi z gry od razu,
  więc trasa jest znana. Evt bez znanego configu daje wpis z `from/to: null`.
