/**
 * Stan pojazdu/gry przesyłany do UI.
 *
 * KONWENCJE (obowiązują wszędzie w protokole):
 * - Jednostki SI / jednostki SDK, konwersja na km/h, mph, °F itd. WYŁĄCZNIE w UI.
 *   prędkość: m/s · dystans: m · paliwo/AdBlue: litry · temperatura: °C · ciśnienie: psi (jak SDK)
 *   · napięcie: V · wear/damage: 0..1 · czas gry: minuty od początku świata gry (SDK `game.time`)
 *   · czasy względne: sekundy (chyba że nazwa pola kończy się na `Min`).
 * - `null` = wartość nieznana / niedostępna w tej wersji gry. Pole pominięte w delcie = bez zmian.
 * - Delty są PŁYTKIE na poziomie grupy: jeśli zmieni się `lights.high`, bridge wysyła cały obiekt `lights`.
 *   (Upraszcza merge po stronie klienta: `state.fast = {...state.fast, ...delta}`.)
 */

/** Kanał szybki — wysyłany 30 Hz (domyślnie) lub 60 Hz. */
export interface FastState {
  /** m/s, ujemne przy cofaniu. */
  speed: number;
  /** obr/min. */
  rpm: number;
  /** Bieg wyświetlany: >0 przód, 0 neutral, <0 wsteczny. */
  gear: number;
  /** Ustawiona prędkość tempomatu, m/s. 0 = wyłączony. */
  cruise: number;
  /** 0..1 */
  throttle: number;
  /** 0..1 */
  brake: number;
  lights: LightsState;
  hazard: boolean;
  /** Dźwignia kierunkowskazu (stan logiczny, nie mruganie żarówki). */
  blinker: "off" | "left" | "right";
  parkingBrake: boolean;
  motorBrake: boolean;
  /** Aktualny stopień retardera, 0 = wył. Maks. w `TruckConfig.retarderSteps`. */
  retarder: number;
  engineOn: boolean;
  electricOn: boolean;
  /** Pozycja w świecie (pod mapę, M4). Wysyłana maks. 10 Hz nawet przy fast=60 Hz. */
  placement: Placement | null;
}

export interface LightsState {
  parking: boolean;
  low: boolean;
  high: boolean;
  beacon: boolean;
  auxFront: "off" | "dimmed" | "full";
  auxRoof: "off" | "dimmed" | "full";
  /** Stan żarówek (mruganie) — do animacji ikon. */
  blinkerLeftOn: boolean;
  blinkerRightOn: boolean;
  brake: boolean;
  reverse: boolean;
}

export interface Placement {
  x: number;
  y: number;
  z: number;
  /** 0..1, jak w SDK (0 = północ, rośnie przeciwnie do ruchu wskazówek). */
  heading: number;
}

/** Kanał wolny — wysyłany 2 Hz. */
export interface SlowState {
  fuel: {
    /** litry */
    amount: number;
    /** km według gry */
    rangeKm: number;
    /** l/km (SDK: średnie spalanie) */
    avgConsumption: number;
    warning: boolean;
  };
  adblue: { amount: number; warning: boolean };
  air: { pressure: number; warning: boolean; emergency: boolean };
  temps: { oil: number; water: number; brake: number };
  oilPressure: { value: number; warning: boolean };
  waterTempWarning: boolean;
  battery: { voltage: number; warning: boolean };
  wear: {
    engine: number;
    transmission: number;
    cabin: number;
    chassis: number;
    wheels: number;
  };
  /** Indeks = indeks przyczepy w SDK (0..9). Pusta tablica = brak przyczep. */
  trailers: TrailerState[];
  nav: {
    /** m do celu, null = brak trasy */
    distance: number | null;
    /** s do celu wg GPS gry, null = brak trasy */
    time: number | null;
    /** m/s, 0 = brak ograniczenia/nieznane */
    speedLimit: number;
  };
  time: {
    /** minuty od początku świata gry */
    game: number;
    /** minuty do wymaganego odpoczynku (może być ujemne = przekroczone) */
    restStopMin: number | null;
    /** skala czasu (np. 19 = 1 min realna ≈ 19 min gry) */
    scale: number;
  };
  /** km */
  odometer: number;
  /** SDK daje tylko wł./wył. (`truck.wipers`), stopnia nie ma. */
  wipers: boolean;
  diffLock: boolean;
  liftAxle: boolean;
  trailerLiftAxle: boolean;
  /** Dane wyliczane przez bridge (komputer pokładowy). */
  trip: TripState;
}

export interface TrailerState {
  connected: boolean;
  cargoDamage: number;
  wear: { chassis: number; wheels: number; body: number };
}

export interface TripState {
  /** m od resetu */
  distance: number;
  /** litry od resetu (z korektą tankowań) */
  fuelUsed: number;
  /** s jazdy (prędkość > 0.5 m/s) od resetu */
  driveTime: number;
  /** l/100 km chwilowe (średnia krocząca 10 s) */
  instantConsumption: number | null;
  /** czas (ms epoch bridge'a) ostatniego resetu */
  resetAt: number;
}

/** Konfiguracja (rzadko się zmienia). Przychodzi w `snapshot` oraz wiadomości `config`. */
export interface ConfigState {
  truck: TruckConfig | null;
  job: JobConfig | null;
  trailers: TrailerConfig[];
}

export interface TruckConfig {
  brand: string;
  brandId: string;
  name: string;
  id: string;
  fuelCapacity: number;
  /** ułamek 0..1 pojemności, poniżej którego gra zapala warning */
  fuelWarningFactor: number;
  adblueCapacity: number;
  airPressureWarning: number;
  airPressureEmergency: number;
  rpmLimit: number;
  forwardGears: number;
  reverseGears: number;
  retarderSteps: number;
  licensePlate: string | null;
}

export interface JobConfig {
  cargo: string;
  cargoId: string;
  /** kg */
  mass: number;
  /** waluta gry (EUR dla ETS2) */
  income: number;
  /** minuta gry, do której trzeba dostarczyć; null = bez terminu (np. special transport) */
  deliveryTime: number | null;
  plannedDistanceKm: number;
  source: Place;
  destination: Place;
  /** "cargo_market" | "quick_job" | "freight_market" | "external_contracts" | "external_market" | … */
  market: string;
  special: boolean;
  cargoLoaded: boolean;
}

export interface Place {
  city: string;
  cityId: string;
  company: string;
  companyId: string;
}

export interface TrailerConfig {
  index: number;
  id: string;
  name: string;
  brand: string | null;
  bodyType: string | null;
  licensePlate: string | null;
}

/** Status połączenia z grą (bridge → UI). */
export interface GameStatus {
  /** skąd bridge bierze dane */
  source: "pipe" | "mock" | "replay" | "rencloud";
  /** true = plugin/źródło połączone i gra działa */
  connected: boolean;
  paused: boolean;
  game: "ets2" | "ats" | null;
  gameVersion: string | null;
  /** czy input device jest aktywne (gra potwierdziła) */
  inputActive: boolean;
  /** czy sterowanie jest włączone w konfiguracji bridge/pluginu */
  inputEnabled: boolean;
}

/** Pełny stan — wysyłany w `snapshot`. */
export interface FullState {
  status: GameStatus;
  fast: FastState;
  slow: SlowState;
  config: ConfigState;
  /** aktualnie aktywne alerty */
  alerts: import("./alerts.ts").Alert[];
  media: import("./media.ts").MediaState | null;
}

/** Delta: każde pole grupy opcjonalne. */
export type Delta<T> = { [K in keyof T]?: T[K] };
