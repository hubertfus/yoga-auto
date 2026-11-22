/**
 * Własne ikony kontrolek pojazdu (rysunki oryginalne; ogólne symbole kontrolek, bez zasobów Apple).
 * Styl zgodny z Lucide: siatka 24×24, obrys 2 px, końce i łączenia zaokrąglone, `currentColor`.
 */
import type { ReactNode } from "react";

export interface CustomIconDef {
  /** elementy SVG (dzieci `<svg viewBox="0 0 24 24">`) */
  body: ReactNode;
  /** wypełnione elementy (np. kropki), rysowane jako fill zamiast stroke */
  label: string;
}

const dot = (cx: number, cy: number, r = 1) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} fill="currentColor" stroke="none" />;

export const CUSTOM_ICONS = {
  /** światła postojowe: dwie lampy po bokach połączone poziomą kreską */
  "lights-parking": {
    label: "Światła postojowe",
    body: (
      <>
        <path d="M8.5 6.5c-3 0-5.5 2.5-5.5 5.5s2.5 5.5 5.5 5.5z" />
        <path d="M15.5 6.5c3 0 5.5 2.5 5.5 5.5s-2.5 5.5-5.5 5.5z" />
        <path d="M8.5 12h7" />
      </>
    ),
  },
  /** światła mijania: lampa + promienie opadające ukośnie w dół */
  "lights-low": {
    label: "Światła mijania",
    body: (
      <>
        <path d="M9.5 5.5c-3.6 0-6.5 2.9-6.5 6.5s2.9 6.5 6.5 6.5z" />
        <path d="M13 7.5l8 2.5" />
        <path d="M13 11.5l8 2.5" />
        <path d="M13 15.5l8 2.5" />
      </>
    ),
  },
  /** światła drogowe: lampa + promienie poziome */
  "lights-high": {
    label: "Światła drogowe",
    body: (
      <>
        <path d="M9.5 5.5c-3.6 0-6.5 2.9-6.5 6.5s2.9 6.5 6.5 6.5z" />
        <path d="M13 6.5h8" />
        <path d="M13 10.2h8" />
        <path d="M13 13.8h8" />
        <path d="M13 17.5h8" />
      </>
    ),
  },
  /** kogut: kopuła na podstawie z promieniami */
  beacon: {
    label: "Kogut",
    body: (
      <>
        <path d="M5 20h14" />
        <path d="M7 20v-5a5 5 0 0 1 10 0v5" />
        <path d="M12 3v2" />
        <path d="M4.6 6.6l1.4 1.4" />
        <path d="M19.4 6.6L18 8" />
        <path d="M2 12h2" />
        <path d="M20 12h2" />
      </>
    ),
  },
  /** światła awaryjne: trójkąt w trójkącie */
  hazard: {
    label: "Światła awaryjne",
    body: (
      <>
        <path d="M12 3.2l9.4 16.3H2.6z" />
        <path d="M12 9.2l4.2 7.3H7.8z" />
      </>
    ),
  },
  /** retarder: bęben z falami (odprowadzanie ciepła) */
  retarder: {
    label: "Retarder",
    body: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M7 10.5c1.2-1.6 2.4-1.6 3.5 0s2.3 1.6 3.5 0 2.3-1.6 3 0" />
        <path d="M7 14.5c1.2-1.6 2.4-1.6 3.5 0s2.3 1.6 3.5 0 2.3-1.6 3 0" />
      </>
    ),
  },
  /** hamulec silnikowy: tłok w cylindrze ze strzałką */
  "engine-brake": {
    label: "Hamulec silnikowy",
    body: (
      <>
        <rect x="4" y="3.5" width="9" height="11" rx="1.5" />
        <path d="M8.5 14.5v4" />
        <path d="M5.5 18.5h6" />
        <path d="M17 6v8" />
        <path d="M14.5 11.5L17 14l2.5-2.5" />
      </>
    ),
  },
  /** blokada mostu: dwa koła połączone osią z zamkiem */
  "diff-lock": {
    label: "Blokada mostu",
    body: (
      <>
        <circle cx="5.5" cy="12" r="3.5" />
        <circle cx="18.5" cy="12" r="3.5" />
        <path d="M9 12h6" />
        <rect x="10" y="9" width="4" height="6" rx="1" />
        <path d="M10.8 12h2.4" />
      </>
    ),
  },
  /** oś podnoszona: koło z strzałką w górę */
  "lift-axle": {
    label: "Oś podnoszona",
    body: (
      <>
        <circle cx="12" cy="16.5" r="3.5" />
        <path d="M12 12.5V3.5" />
        <path d="M8.5 7l3.5-3.5L15.5 7" />
        <path d="M3.5 21h17" />
      </>
    ),
  },
  /** naczepa: skrzynia z zaczepem i kołami */
  trailer: {
    label: "Naczepa",
    body: (
      <>
        <path d="M3 5.5h13v10H3z" />
        <path d="M16 12h5" />
        <circle cx="7" cy="18.5" r="1.8" />
        <circle cx="12.5" cy="18.5" r="1.8" />
      </>
    ),
  },
  /** zaczep naczepy (siodło): łączenie dwóch elementów */
  coupling: {
    label: "Zaczep",
    body: (
      <>
        <rect x="2.5" y="9" width="7" height="6" rx="1.5" />
        <rect x="14.5" y="9" width="7" height="6" rx="1.5" />
        <path d="M9.5 12h5" />
        <path d="M12 7v2" />
        <path d="M12 15v2" />
      </>
    ),
  },
  /** tempomat: tarcza z wskazówką */
  cruise: {
    label: "Tempomat",
    body: (
      <>
        <path d="M3.5 17.5a9 9 0 1 1 17 0" />
        <path d="M12 17.5l4-5.5" />
        <circle cx="12" cy="17.5" r="1.3" />
        <path d="M6 12.5l1.2.8" />
        <path d="M12 7v1.5" />
        <path d="M18 12.5l-1.2.8" />
      </>
    ),
  },
  /** hamulec postojowy: (P) */
  "parking-brake": {
    label: "Hamulec postojowy",
    body: (
      <>
        <circle cx="12" cy="12" r="6" />
        <path d="M10.2 15.5v-7h2.4a2 2 0 0 1 0 4h-2.4" />
        <path d="M4.2 8a8.5 8.5 0 0 0 0 8" />
        <path d="M19.8 8a8.5 8.5 0 0 1 0 8" />
      </>
    ),
  },
  /** wycieraczki: szyba i pióro */
  wipers: {
    label: "Wycieraczki",
    body: (
      <>
        <path d="M2.5 18.5a10.5 10.5 0 0 1 19 0z" />
        <path d="M12 18.5l5-10" />
        <path d="M12 18.5l-6-6.5" />
        {dot(12, 18.5, 1.2)}
      </>
    ),
  },
  /** zapłon: kluczyk w kontaktronie */
  ignition: {
    label: "Zapłon",
    body: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 6.5v5.5" />
        <path d="M8.2 8.6a5.5 5.5 0 1 0 7.6 0" />
      </>
    ),
  },
} as const satisfies Record<string, CustomIconDef>;

export type CustomIconName = keyof typeof CUSTOM_ICONS;
