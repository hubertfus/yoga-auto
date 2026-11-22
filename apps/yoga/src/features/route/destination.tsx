/**
 * Wybór celu trasy na tablecie. Gra nie udostępnia w SDK celu ustawionego w jej GPS, więc bez zlecenia
 * cel wybiera się tutaj: wyszukiwarka miast/firm (`route-places.json` z katalogu kafli) albo przytrzymanie
 * palca na mapie. Bridge liczy trasę (`route.set`); nowe zlecenie zastępuje ręczny cel.
 */
import { useEffect, useMemo, useState } from "react";
import { GlassButton, Icon, Sheet } from "@yoga-auto/glass-ui";
import type { RouteTarget } from "@yoga-auto/protocol";
import { client, getToken } from "../../core/client.ts";
import { store, useRoute } from "../../core/store.ts";
import { withToken } from "../map/tiles.ts";

let seq = 0;

/** Ustaw / wyczyść (null) ręczny cel trasy. false = brak połączenia z bridge'em. */
export function sendRouteTarget(target: RouteTarget | null): boolean {
  return client.send({ t: "route.set", id: `rt${Date.now().toString(36)}${seq++}`, target });
}

export interface Place {
  name: string;
  /** miasto (dla firm) albo kraj (dla miast) */
  sub: string;
  x: number;
  z: number;
  kind: "city" | "company";
}

interface PlacesJson {
  v: 1;
  cities: [string, number, number, string][];
  companies: [string, string, number, number][];
}

/** Tokeny krajów z danych gry → nazwy po polsku (nieznane: token z wielkiej litery). */
const COUNTRY_PL: Record<string, string> = {
  uk: "Wielka Brytania",
  netherlands: "Holandia",
  belgium: "Belgia",
  germany: "Niemcy",
  switzerland: "Szwajcaria",
  slovakia: "Słowacja",
  czech: "Czechy",
  france: "Francja",
  austria: "Austria",
  luxembourg: "Luksemburg",
  italy: "Włochy",
  poland: "Polska",
  romania: "Rumunia",
  bulgaria: "Bułgaria",
  turkey: "Turcja",
  slovenia: "Słowenia",
  croatia: "Chorwacja",
  bosnia: "Bośnia i Hercegowina",
  serbia: "Serbia",
  kosovo: "Kosowo",
  montenegro: "Czarnogóra",
  albania: "Albania",
  macedonia: "Macedonia Płn.",
  russia: "Rosja",
  lithuania: "Litwa",
  latvia: "Łotwa",
  estonia: "Estonia",
  finland: "Finlandia",
  hungary: "Węgry",
  spain: "Hiszpania",
  portugal: "Portugalia",
  iceland: "Islandia",
  denmark: "Dania",
  sweden: "Szwecja",
  norway: "Norwegia",
};
export const countryName = (token: string): string =>
  COUNTRY_PL[token] ?? token.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

let placesPromise: Promise<Place[]> | null = null;

export function loadPlaces(fetchFn: typeof fetch = fetch): Promise<Place[]> {
  placesPromise ??= fetchFn(withToken("/tiles/route-places.json", getToken()))
    .then((r) => (r.ok ? (r.json() as Promise<PlacesJson>) : null))
    .then((j) =>
      j
        ? [
            ...j.cities.map(([name, x, z, country]): Place => ({
              name,
              sub: countryName(country),
              x,
              z,
              kind: "city",
            })),
            ...j.companies.map(([name, city, x, z]): Place => ({ name, sub: city, x, z, kind: "company" })),
          ]
        : [],
    )
    .catch(() => {
      placesPromise = null; // spróbuj ponownie przy następnym otwarciu
      return [];
    });
  return placesPromise;
}

export function usePlaces(): Place[] | null {
  const [places, setPlaces] = useState<Place[] | null>(null);
  useEffect(() => {
    let alive = true;
    void loadPlaces().then((p) => alive && setPlaces(p));
    return () => {
      alive = false;
    };
  }, []);
  return places;
}

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ł/g, "l");

/** Wyszukiwanie: dopasowanie od początku słowa wygrywa; miasta przed firmami; potem bliżej ciężarówki. */
export function searchPlaces(
  places: readonly Place[],
  query: string,
  from?: { x: number; z: number },
  limit = 40,
): Place[] {
  const q = fold(query.trim());
  const dist = (p: Place) => (from ? Math.hypot(p.x - from.x, p.z - from.z) : 0);
  const scored: { p: Place; s: number }[] = [];
  for (const p of places) {
    const hay = fold(`${p.name} ${p.sub}`);
    let s: number;
    if (!q) s = p.kind === "city" ? 0 : 1;
    else if (fold(p.name).startsWith(q)) s = 0;
    else if (hay.split(/[\s,–-]+/).some((w) => w.startsWith(q))) s = 1;
    else if (hay.includes(q)) s = 2;
    else continue;
    scored.push({ p, s: s * 10 + (p.kind === "city" ? 0 : 1) });
  }
  scored.sort((a, b) => a.s - b.s || dist(a.p) - dist(b.p) || a.p.name.localeCompare(b.p.name, "pl"));
  return scored.slice(0, limit).map((x) => x.p);
}

/** Nazwa dla punktu z mapy: najbliższa firma (≤ 300 m) albo „okolice <miasta>” (≤ 3 km świata). */
export function labelForPoint(places: readonly Place[], x: number, z: number): string {
  let best: Place | null = null;
  let bd = Infinity;
  for (const p of places) {
    const d = Math.hypot(p.x - x, p.z - z);
    const limit = p.kind === "company" ? 300 : 3000;
    if (d <= limit && d < bd) {
      bd = d;
      best = p;
    }
  }
  if (!best) return "Punkt na mapie";
  return best.kind === "company" ? `${best.name}, ${best.sub}` : `Okolice: ${best.name}`;
}

/** Arkusz „Dokąd jedziemy?”: wyszukiwarka miast i firm. */
export function DestinationSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const places = usePlaces();
  const [q, setQ] = useState("");
  const results = useMemo(() => {
    const p = store.state.fast.placement;
    return places ? searchPlaces(places, q, p ?? undefined) : [];
  }, [places, q]);
  useEffect(() => {
    if (!open) setQ("");
  }, [open]);
  const pick = (p: Place) => {
    sendRouteTarget({ x: p.x, z: p.z, label: p.kind === "company" ? `${p.name}, ${p.sub}` : p.name });
    onClose();
  };
  return (
    <Sheet open={open} onClose={onClose} title="Dokąd jedziemy?" detents={["large"]}>
      <div className="rt-search">
        <label className="rt-search__field">
          <Icon name="search" size={22} />
          <input
            type="search"
            value={q}
            placeholder="Miasto albo firma"
            onChange={(e) => setQ(e.target.value)}
            autoComplete="off"
            data-testid="route-search"
          />
        </label>
        <p className="rt-search__hint">Możesz też przytrzymać palec na mapie, żeby ustawić cel w dowolnym miejscu.</p>
        {places === null ? (
          <p className="rt-empty">Wczytuję listę miejsc…</p>
        ) : places.length === 0 ? (
          <p className="rt-empty">Brak listy miejsc na PC (npm run map:graph)</p>
        ) : (
          <ul className="rt-results" data-testid="route-results">
            {results.map((p, i) => (
              <li key={`${p.kind}${i}${p.name}${p.sub}`}>
                <button type="button" onClick={() => pick(p)}>
                  <Icon name={p.kind === "city" ? "city" : "cargo"} size={22} />
                  <span className="rt-results__name">{p.name}</span>
                  <span className="rt-results__sub">{p.sub}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Sheet>
  );
}

/** Pasek celu: „Do: X” + przycisk zakończenia (tylko dla celu wybranego ręcznie). */
export function RouteTargetBar() {
  const route = useRoute();
  if (!route) return null;
  return (
    <div className="rt-target" data-testid="route-target">
      <Icon name="flag" size={18} />
      <span className="rt-target__name">
        {route.to.city}
        {route.to.company ? <span className="ft-dimmer"> · {route.to.company}</span> : null}
      </span>
      {route.manual ? (
        <GlassButton
          size="sm"
          icon={<Icon name="close" />}
          aria-label="Zakończ nawigację"
          onPress={() => void sendRouteTarget(null)}
        />
      ) : null}
    </div>
  );
}
