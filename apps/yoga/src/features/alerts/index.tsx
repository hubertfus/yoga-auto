/**
 * Treść toastów: presentery dla KAŻDEGO `AlertCode` (typ `Record<AlertCode, …>` wymusza kompletność w czasie kompilacji)
 * oraz presentery zdarzeń gry (dostawa, mandat, myto, prom, …). Jednostki z ustawień (`getSettings()` w chwili tworzenia toastu).
 */
import type { Alert, AlertCode, GameEvent, GameEventKind } from "@yoga-auto/protocol";
import { Icon } from "@yoga-auto/glass-ui";
import { registerAlertPresenter, registerEventPresenter, type AlertPresenter, type EventPresenter, type ToastContent } from "../../core/registry.ts";
import { getSettings } from "../../core/settings.ts";
import {
  formatDistance,
  formatKm,
  formatLimit,
  formatMinutes,
  formatMoney,
  formatPercent,
  formatPressure,
  formatSpeed,
  formatTemp,
  formatVolume,
  speedLabel,
  volumeLabel,
} from "../units/index.ts";

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

export const PART_NAMES: Record<string, string> = {
  engine: "silnik",
  transmission: "skrzynia biegów",
  cabin: "kabina",
  chassis: "podwozie",
  wheels: "koła",
  trailer: "naczepa",
  cargo: "ładunek",
};
const partName = (p: unknown): string => PART_NAMES[str(p) ?? ""] ?? str(p) ?? "pojazd";

const icon = (name: string) => <Icon name={name} size={28} />;

const dataOf = (a: Alert) => a.data ?? {};

/** Alert → treść toastu. Brak pola w `data` nie wywala prezentera (tekst bez liczby). */
export const ALERT_PRESENTERS: Record<AlertCode, AlertPresenter> = {
  "fuel.low": (a) => {
    const u = getSettings().units;
    const d = dataOf(a);
    const range = num(d.rangeKm);
    const amount = num(d.amount);
    const parts = [
      range !== null ? `Zasięg ${formatKm(range, u)}` : null,
      amount !== null ? `${formatVolume(amount, u)} ${volumeLabel(u)}` : null,
      "najbliższa stacja w GPS",
    ].filter(Boolean);
    return { title: "Niski poziom paliwa", body: parts.join(" · "), icon: icon("fuel"), level: a.level };
  },
  "adblue.low": (a) => {
    const u = getSettings().units;
    const amount = num(dataOf(a).amount);
    return {
      title: "Niski poziom AdBlue",
      body: amount !== null ? `Zostało ${formatVolume(amount, u)} ${volumeLabel(u)} — uzupełnij na stacji` : "Uzupełnij na stacji",
      icon: icon("droplet"),
      level: a.level,
    };
  },
  "air.low": (a) => {
    const p = num(dataOf(a).pressure);
    return {
      title: "Niskie ciśnienie powietrza",
      body: p !== null ? `${formatPressure(p)} — poczekaj, aż sprężarka napompuje` : "Poczekaj, aż sprężarka napompuje",
      icon: icon("air"),
      level: a.level,
    };
  },
  "air.emergency": (a) => {
    const p = num(dataOf(a).pressure);
    return {
      title: "Ciśnienie powietrza krytyczne",
      body: p !== null ? `${formatPressure(p)} — hamulce mogą się zablokować` : "Hamulce mogą się zablokować",
      icon: icon("air"),
      level: "critical",
    };
  },
  "oil.pressure": (a) => {
    const v = num(dataOf(a).value);
    return {
      title: "Niskie ciśnienie oleju",
      body: v !== null ? `${formatPressure(v)} — zatrzymaj się i sprawdź silnik` : "Zatrzymaj się i sprawdź silnik",
      icon: icon("oil"),
      level: a.level,
    };
  },
  "water.temp": (a) => {
    const u = getSettings().units;
    const t = num(dataOf(a).temp);
    return {
      title: "Wysoka temperatura silnika",
      body: t !== null ? `Płyn chłodzący ${formatTemp(t, u)} — zwolnij i pozwól ostygnąć` : "Zwolnij i pozwól silnikowi ostygnąć",
      icon: icon("thermometer"),
      level: a.level,
    };
  },
  "battery.voltage": (a) => {
    const v = num(dataOf(a).voltage);
    return {
      title: "Niskie napięcie akumulatora",
      body: v !== null ? `${v.toFixed(1)} V — alternator nie ładuje` : "Alternator nie ładuje",
      icon: icon("battery-low"),
      level: a.level,
    };
  },
  "damage.hit": (a) => {
    const d = dataOf(a);
    const delta = num(d.delta);
    return {
      title: "Uderzenie",
      body: `Uszkodzone: ${partName(d.part)}${delta !== null ? ` (+${formatPercent(delta, true)})` : ""}`,
      icon: icon("damage"),
      level: a.level,
    };
  },
  "damage.high": (a) => {
    const d = dataOf(a);
    const wear = num(d.wear);
    return {
      title: "Poważne uszkodzenia",
      body: `${partName(d.part)}${wear !== null ? ` ${formatPercent(wear)}` : ""} — rozważ warsztat`,
      icon: icon("wrench"),
      level: a.level,
    };
  },
  "rest.soon": (a) => {
    const m = num(dataOf(a).minutes);
    return {
      title: "Zbliża się odpoczynek",
      body: m !== null ? `Za ${formatMinutes(m)} — poszukaj parkingu` : "Poszukaj parkingu",
      icon: icon("bed"),
      level: a.level,
    };
  },
  "rest.now": (a) => {
    const m = num(dataOf(a).minutes);
    return {
      title: "Czas na odpoczynek",
      body: m !== null ? `Zostało ${formatMinutes(Math.max(0, m))} jazdy` : "Zjedź na parking",
      icon: icon("bed"),
      level: a.level,
    };
  },
  "rest.overdue": (a) => {
    const m = num(dataOf(a).minutes);
    return {
      title: "Przekroczony czas jazdy",
      body: m !== null && m < 0 ? `Spóźniony odpoczynek o ${formatMinutes(-m)}` : "Odpocznij jak najszybciej",
      icon: icon("bed"),
      level: a.level,
    };
  },
  speeding: (a) => {
    const u = getSettings().units;
    const d = dataOf(a);
    const limit = num(d.limit);
    const speed = num(d.speed);
    return {
      title: "Przekroczenie prędkości",
      body:
        limit !== null && speed !== null
          ? `${formatSpeed(speed, u)} / limit ${formatLimit(limit, u)} ${speedLabel(u)}`
          : "Zwolnij",
      icon: icon("speedometer"),
      level: a.level,
    };
  },
  "job.late": (a) => {
    const d = dataOf(a);
    const over = num(d.overdueMin);
    const predicted = num(d.predictedLateMin);
    const body =
      over !== null
        ? `Termin minął ${formatMinutes(over)} temu`
        : predicted !== null
          ? `Przy obecnym tempie spóźnisz się o ${formatMinutes(predicted)}`
          : "Dostawa po terminie";
    return { title: "Spóźnienie z dostawą", body, icon: icon("clock"), level: a.level };
  },
  "game.disconnected": (a) => {
    const source = str(dataOf(a).source);
    return {
      title: "Brak połączenia z grą",
      body: source ? `Źródło danych: ${source}` : "Sprawdź, czy ETS2 działa i plugin jest załadowany",
      icon: icon("wifi-off"),
      level: a.level,
    };
  },
};

/** Zdarzenia gry → toast (null = bez toastu). */
export const EVENT_PRESENTERS: { [K in GameEventKind]?: EventPresenter<K> } = {
  "job.delivered": (e) => {
    const u = getSettings().units;
    const bits = [
      formatMoney(e.revenue),
      `${formatDistance(e.distanceKm * 1000, u)}`,
      e.cargoDamage > 0 ? `uszkodzenie ładunku ${formatPercent(e.cargoDamage, true)}` : "bez uszkodzeń",
      e.earnedXp ? `+${e.earnedXp} XP` : null,
    ].filter(Boolean);
    return { title: "Dostawa zrealizowana", body: bits.join(" · "), icon: icon("check"), level: "info", duration: 9000 };
  },
  "job.started": (e) => ({
    title: "Nowe zlecenie",
    body: `${e.job.source.city} → ${e.job.destination.city} · ${e.job.cargo} · ${formatMoney(e.job.income)}`,
    icon: icon("package"),
    level: "info",
  }),
  "job.cancelled": (e) => ({
    title: "Zlecenie anulowane",
    body: e.penalty ? `Kara ${formatMoney(e.penalty)}` : undefined,
    icon: icon("x"),
    level: e.penalty ? "warning" : "info",
  }),
  "player.fined": (e) => ({
    title: "Mandat",
    body: `${e.offence} · ${formatMoney(e.amount)}`,
    icon: icon("warning"),
    level: "warning",
    duration: 7000,
  }),
  "player.tollgate": (e) => ({ title: "Bramka płatna", body: formatMoney(e.amount), icon: icon("euro"), level: "info" }),
  "player.ferry": (e) => ({
    title: "Prom",
    body: `${e.source} → ${e.target} · ${formatMoney(e.amount)}`,
    icon: icon("route"),
    level: "info",
  }),
  "player.train": (e) => ({
    title: "Pociąg",
    body: `${e.source} → ${e.target} · ${formatMoney(e.amount)}`,
    icon: icon("route"),
    level: "info",
  }),
  "player.refuel": (e) => {
    const u = getSettings().units;
    return { title: "Zatankowano", body: `${formatVolume(e.amount, u)} ${volumeLabel(u)}`, icon: icon("fuel"), level: "info" };
  },
  "trailer.attached": () => ({ title: "Naczepa zaczepiona", icon: icon("coupling"), level: "info", duration: 3000 }),
  "trailer.detached": () => ({ title: "Naczepa odczepiona", icon: icon("coupling"), level: "info", duration: 3000 }),
};

for (const [code, presenter] of Object.entries(ALERT_PRESENTERS) as [AlertCode, AlertPresenter][]) {
  registerAlertPresenter(code, presenter);
}
for (const [kind, presenter] of Object.entries(EVENT_PRESENTERS) as [GameEventKind, (e: GameEvent) => ToastContent | null][]) {
  registerEventPresenter(kind, presenter as never);
}
