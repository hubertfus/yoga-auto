# yoga-auto — analiza techniczna

> Stan na **2026-11-22**. Wszystko, co oznaczono ✅, zweryfikowano w sieci w tej sesji.
> ⚠️ = niepewne, wymaga spike'a. Źródła na końcu dokumentu.

## 0. TL;DR

| Obszar | Decyzja | Dlaczego |
|---|---|---|
| Telemetria | **Własny plugin C++** na oficjalnym SCS SDK (telemetria + input w jednym DLL) | Gotowe pluginy są martwe albo nie mają sterowania; i tak musimy pisać plugin do inputu |
| Sterowanie | **SCS Input API, urządzenie `semantical`** | Plugin „naciska” nazwane kontrolki gry (`light`, `flasher4way`, `cruiectrl`…). Działa bez fokusu okna, bez sterowników, prawdopodobnie bez przypisywania przycisków |
| Plugin ↔ bridge | **Named pipe** `\\.\pipe\yoga-auto`, ramki z prefiksem długości, JSON | Node czyta pipe bez natywnych addonów; nic nie blokuje wątku gry |
| Bridge | **Node.js 24 + TypeScript** | Node 24 już jest na PC; typy protokołu współdzielone z frontendem; dojrzałe `ws` i mDNS |
| PC ↔ Yoga | **WebSocket w LAN** (JSON v1), kanał szybki 30–60 Hz + kanał wolny + eventy | Budżet < 50 ms jest realny po Wi-Fi 5 GHz |
| Frontend | **PWA w Edge w trybie kiosk**, Vite + React 19 | Edge jest na każdym Windowsie, Chromium wspiera `backdrop-filter: url()` (refrakcja), zero instalatorów |
| Mapa | **Etap M4**, `truckermudgeon/maps` (PMTiles + MapLibre) | Projekt żyje (commit 2026-11-21) i wspiera ETS2. GPL-3.0 |

---

## 1. Odczyt danych z gry (telemetria)

### 1.1 SCS Telemetry SDK — stan aktualny

- Gra: **ETS2 1.62** (wydana 2026-11-05), DLC Iceland (2026-11-10), patch „Coaches” (2026-11-12). ✅
- SDK: najnowsza paczka to **1.16 (stable)**, Windows/Linux/macOS, `https://download.eurotrucksimulator2.com/scs_sdk_1_16.zip`. ✅
- **Input API jest od paczki 1.14:** „basic input devices”. Dokumentacja i przykłady są tylko w archiwum (`examples/input_semantical`, `examples/input_generic` ⚠️ nazwa drugiego). ✅
- Uwaga na numerację. Wersja paczki SDK (1.14/1.16) to co innego niż wersja API telemetrii gry (np. ETS2 telemetry 1.18 itd.). SDK jest kompatybilne wstecz: plugin deklaruje minimalną wersję API, gra podaje swoją.

**Model działania SDK:** gra ładuje DLL z `bin\win_x64\plugins\`. Wołane są `scs_telemetry_init` i `scs_input_init`. Plugin rejestruje:
- **kanały** (wartości co klatkę: prędkość, RPM…) przez `register_for_channel`. Callback dostaje wartość tylko przy zmianie albo co klatkę, zależnie od flag;
- **eventy** `frame_start` / `frame_end` / `paused` / `started` / `configuration` / `gameplay`;
- **konfigurację** (config event): `job`, `truck`, `trailer.N`, `controls`, `hshifter`, `substances`;
- **gameplay events:** `job.delivered`, `job.cancelled`, `player.fined`, `player.tollgate.paid`, `player.use.ferry`, `player.use.train`, `player.refuel.paid` (⚠️ ten ostatni znany z błędów: wg TruckSim-Telemetry „triggers only once per game session”).

**Częstotliwość:** callbacki lecą **co wyrenderowaną klatkę gry** (60–144 Hz). Nie ma stałego tickera. RenCloud: „updated as fast as ETS2/ATS can”. Opóźnienie po stronie gry ≈ 1 klatka (7–16 ms).

### 1.2 Kanały, których potrzebujemy (mapowanie na SDK)

| Dana | Kanał SDK (`SCS_TELEMETRY_*`) | Częst. | Uwagi |
|---|---|---|---|
| Prędkość | `truck.speed` (m/s, ze znakiem) | szybki | |
| RPM | `truck.engine.rpm` | szybki | |
| Bieg | `truck.displayed.gear` | szybki | wyświetlany ≠ `truck.engine.gear` |
| Paliwo / zasięg / średnie spalanie | `truck.fuel`, `truck.fuel.range`, `truck.fuel.consumption.average`; pojemność z config `truck` | wolny | |
| AdBlue | `truck.adblue` (+ warning) | wolny | |
| Tempomat | `truck.cruise_control` (m/s, 0 = wył.) | szybki | |
| Ograniczenie prędkości | `truck.navigation.speed.limit` | wolny | od API 1.12 ETS2 |
| Nawigacja: dystans / ETA | `truck.navigation.distance`, `truck.navigation.time` | wolny | czas w sekundach realnych ⚠️ (do weryfikacji vs czas gry) |
| Zlecenie | config `job`: cargo, masa, miasto/firma źródło-cel, income, `delivery.time`, `planned_distance.km`, `job.market`, `special_job` | event | |
| Uszkodzenia | `truck.wear.engine/transmission/cabin/chassis/wheels`, `trailer.wear.*`, `trailer.cargo.damage` | wolny | |
| Ostrzeżenia | `truck.brake.air.pressure.warning/emergency`, `truck.fuel.warning`, `truck.adblue.warning`, `truck.oil.pressure.warning`, `truck.water.temperature.warning`, `truck.battery.voltage.warning` | wolny + edge→event | |
| Czas gry | `game.time` (minuty od startu), `local.scale` | wolny | |
| Zmęczenie / odpoczynek | `rest.stop` (minuty do wymaganego postoju) | wolny | |
| Światła | `truck.light.parking`, `.low_beam`, `.high_beam`, `.beacon`, `.aux.front`, `.aux.roof`, `.lblinker`, `.rblinker`, `.brake`, `.reverse` | szybki (bool) | dźwignie: `truck.lblinker` (dźwignia) vs `truck.light.lblinker` (żarówka miga) |
| Awaryjne | `truck.hazard_warning` | szybki | |
| Wycieraczki | `truck.wipers` | wolny | |
| Retarder | `truck.retarder.level`; ilość stopni z config `truck` (`retarder.steps`) | szybki | |
| Hamulec silnikowy | `truck.motor_brake` | szybki | |
| Hamulec postojowy | `truck.parking_brake` | szybki | |
| Ciśnienie powietrza | `truck.brake.air.pressure` | wolny | |
| Temperatury | `truck.oil.temperature`, `truck.water.temperature`, `truck.brake.temperature` | wolny | |
| Silnik / elektryka | `truck.engine.enabled`, `truck.electric.enabled` | wolny | |
| Blokada mostu / oś podnoszona | `truck.differential_lock`, `truck.lift_axle` (+ `trailer.lift_axle`) | wolny | |
| Przyczepa | `trailer.connected` | wolny | |
| Pozycja (pod mapę) | `truck.world.placement` (dvec3 + heading) | szybki | M4 |
| Pauza | event `paused`/`started` | event | |

### 1.3 Gotowe pluginy i biblioteki — weryfikacja

| Projekt | Co robi | Ostatnia aktywność | Wsparcie nowych ETS2 | Sterowanie | Licencja | Werdykt |
|---|---|---|---|---|---|---|
| **RenCloud/scs-sdk-plugin** | DLL → shared memory `Local\SCSTelemetry` | ostatni commit **2023-09-21**, release V.1.12.1 | tabela w README kończy się na ETS2 1.46 | ❌ (issue #119 „Add input support” otwarte od 2024) | MIT | Martwy, ale prawdopodobnie dalej działa (SDK kompatybilne wstecz). Tylko fallback |
| **truckermudgeon/scs-sdk-plugin** (fork) | j.w. + Linux/macOS | **2025-12-19**, v1.12.1 | brak deklaracji | ❌ | MIT | Port na POSIX, bez nowych funkcji |
| **kniffen/TruckSim-Telemetry** (`trucksim-telemetry`) | Node: natywny addon (node-gyp) czytający shared memory RenClouda, eventy | brak GitHub release'ów; `engines: node >=22`; dokumentacja v1.0.0 | zależy od pluginu RenClouda | ❌ | MIT | Wygodny, ale wymaga VS Build Tools przy `npm install` i ciągnie martwy plugin |
| **Funbit/ets2-telemetry-server** | C# serwer HTTP + skórki | ostatni push **2022-08** | zgłoszenia „not working anymore” | ❌ | GPL | **Martwy** |
| mike-koch/ets2-telemetry-server (fork) | j.w. | ~2019 | częściowo | ❌ | GPL | Martwy |
| **ETS2LA/controller** (dawniej scs-sdk-controller) | DLL z **semantical input device**, shared memory `Local\ETS2LA_Controller`, 297 kontrolek, klienci Python/C++ | **2026-11-14** (v1.1.0, protocol 2) | aktywny, używany przez ETS2 Lane Assist | ✅ | **GPL-3.0** | Najlepsza referencja dla naszego inputu. Kod GPL → czytamy, nie kopiujemy (chyba że cały projekt będzie GPL) |
| Rust: `scs-sdk-plugin` / `scs-sdk-sys` | framework na pluginy telemetria + input | aktywne crates | n/d | ✅ (bindingi) | ⚠️ | Alternatywa dla C++, jeśli wolisz Rust |

**Wniosek:** żaden gotowy plugin nie łączy aktualnej telemetrii ze sterowaniem i transportem przyjaznym Node. Własny plugin to ~1–1.5 k linii C++. SDK daje nagłówki i przykłady, a ETS2LA jest wzorcem wejścia. Zyskujemy:
1. jeden DLL do zainstalowania,
2. dokładnie te kanały, których potrzebujemy, plus własny format,
3. transport przez named pipe, czyli zero natywnych addonów w Node,
4. pętlę zamkniętą: komenda → stan z telemetrii w tym samym procesie.

**Fallback na M1**, jeśli plugin się opóźni: RenCloud DLL + `trucksim-telemetry`. Bridge ma interfejs `TelemetrySource`, więc źródło jest wymienne.

---

## 2. Sterowanie grą z tabletu (najważniejsze)

Kluczowa obserwacja: **gra działa na PC, a dotyk jest na innym urządzeniu**. Okno ETS2 nigdy nie traci fokusu, bo użytkownik nie klika na PC. To mocno łagodzi problemy SendInput. Mimo to Input API wygrywa.

### 2.1 Porównanie

| Kryterium | **A. SCS Input API (semantical)** | B. SCS Input API (generic) | C. Wirtualny pad (ViGEm / vJoy) | D. SendInput (scancode) |
|---|---|---|---|---|
| Mechanizm | plugin podaje wartości nazwanych kontrolek gry (`light`, `cruiectrl`…) | plugin = nowe urządzenie z przyciskami; użytkownik przypisuje je w menu gry | sterownik systemowy emuluje pada/joystick, gra widzi DirectInput/XInput | systemowe wstrzykiwanie klawiszy |
| Niezawodność | ✅ wysoka, wejście trafia w pętlę inputu gry co klatkę | ✅ wysoka | 🟡 dobra, ale ViGEmBus **zarchiwizowany 2023-11-02** (działa, bez aktualizacji); vJoy żyje tylko w forkach (njz3, jshafer817, BrunnerInnovation v2.2.2.0), podpisy sterowników na Win11 bywają problemem | 🟡 zależy od fokusu, układu klawiatury i tego, czy gra czyta raw input |
| Opóźnienie (od komendy w bridge) | ≤ 1 klatka (~7–16 ms) | ≤ 1 klatka | 1–2 klatki | 1–2 klatki |
| Wpływ na ustawienia gry | ⚠️ prawdopodobnie **żaden**: semantical mapuje się na „mix” kontrolek z `controls.sii` (do potwierdzenia w spike'u) | trzeba przypisać ~40 akcji w Opcje → Sterowanie, raz | trzeba przypisać przyciski pada; ryzyko konfliktu z kierownicą i padem | trzeba znać bindy klawiszy użytkownika; zmiana bindów psuje sterowanie |
| Fullscreen / fokus | ✅ niezależne od okna | ✅ | ✅ (pad działa w tle, jeśli gra nie ignoruje inputu bez fokusu) | ❌ wymaga fokusu na grze; exclusive fullscreen + UAC/okna na wierzchu psują |
| TruckersMP | 🟡 SDK telemetrii to droga **zalecana** przez TMP dla deweloperów („use our SDK or the SCS telemetry SDK where possible”). Input w SDK nie jest nazwany wprost, ale to oficjalny mechanizm SCS. Przyciski świateł/kierunkowskazów nie zmieniają fizyki ani gameplayu | j.w. | 🟡 neutralny (to „sprzęt”) | 🟡 makra nie są wprost zakazane; reguła §2.1 dotyczy narzędzi „to change gameplay” |
| Instalacja | DLL w `plugins\` | DLL + bindy | instalacja sterownika (admin) | nic |
| Złożoność | M (C++, wzorzec SDK + ETS2LA) | M | M (+ sterownik) | S |
| Analogi (osie) | ✅ float | ✅ | ✅ | ❌ |

**Decyzja: A (semantical) jako główny tor, B (generic) jako awaryjny w tym samym DLL** dla akcji, których nie ma w semantical. D jest tylko wyjściem awaryjnym w bridge (np. screenshot, jeśli nie ma go w SDK), za flagą. C odrzucamy: sterownik bez aktualizacji, a nic nie daje ponad A.

### 2.2 Jak to działa w praktyce (A)

```
scs_input_init(version, params)
  device.type = SCS_INPUT_DEVICE_TYPE_semantical
  device.inputs[] = { name:"light", value_type: bool }, { name:"flasher4way", ... } ...
  device.input_active_callback = on_active        // gra mówi: urządzenie aktywne / nieaktywne
  device.input_event_callback  = on_event         // gra pyta co klatkę: "masz zdarzenie?"
params.register_device(&device)

on_event(event, flags):
  if flags & first_in_frame: pobierz z kolejki komend wszystko, co przyszło od bridge
  zwróć kolejne (input_index, value) → SCS_RESULT_ok
  koniec → SCS_RESULT_not_found
```

**Press** = wartość `true` przez **co najmniej 2 klatki, potem `false`**. Jednoklatkowe impulsy bywają gubione (ETS2LA ma osobny mechanizm `pulses`). **Hold** (klakson, kierunkowskaz trzymany) = `true` aż do `release` albo **watchdoga 3 s** bez heartbeatu. Wzorzec ETS2LA zwalnia wszystko po 3 s ciszy, inaczej klakson wyłby po zerwaniu Wi-Fi.

### 2.3 Akcje → kontrolki semantical

> **Aktualizacja 2026-11-22 (po pobraniu SDK 1.16):**
> - Nagłówek `scssdk_input_device.h` potwierdza: wejścia urządzenia semantical „map directly to mixes with the same name… **No binding UI is supported**”. Działa więc bez żadnej konfiguracji przez użytkownika. Obsługiwane są tylko mixy, które w `controls.sii` mają wpis `semantical.<mix>?0`.
> - `controls.sii` z Twojego profilu (ETS2 1.62) zawiera **297** takich mixów. **Wszystkie 56 akcji** z `shared/protocol/src/actions.ts` są na tej liście. Część nazw poprawiłem: `diflock`, `engineelect`, `liftaxlet`, `attach`, `navmap`, `radioup`/`radiodown`. Doszły nowe akcje: `lightoff`, `radiotoggle`, `radiofav`, `camcycle`, `showhud`, `showmirrors`, `advzoomin/out`, `advetamode`.
> - Wszystkie 63 kanały z `PLUGIN_CHANNELS` istnieją w nagłówkach SDK. Poprawione: `truck.light.beam.low/high`, `truck.brake.parking/motor/retarder`, `truck.fuel.amount`.
> - **Aktualne nazwy są w `actions.ts`; tabela niżej jest historyczna.** Do sprawdzenia w grze (S1-0) zostało: czy press się rejestruje, ile klatek musi trwać, jak zachowuje się Convoy.

Nazwy oznaczone ✅ potwierdziłem w `docs/CONTROLS.md` z ETS2LA/controller. Reszta ⚠️ do weryfikacji w spike'u S1-0 (z `controls.sii` i przykładu SDK).

| Akcja UI | Kontrolka | Typ | Stan z telemetrii (feedback) |
|---|---|---|---|
| Światła: cykl (postojowe → mijania → wył.) | `light` ✅ | press | `truck.light.parking`, `.low_beam` |
| Drogowe | `hblight` ✅ | press | `truck.light.high_beam` |
| Mrugnięcie drogowymi | `lighthorn` ⚠️ | hold | — |
| Awaryjne | `flasher4way` ✅ | press | `truck.hazard_warning` |
| Kogut | `beacon` ⚠️ | press | `truck.light.beacon` |
| Kierunkowskaz L / P | `lblinker` / `rblinker` ✅ (+ `lblinkerh`/`rblinkerh` hold ✅) | press / hold | `truck.lblinker`, `truck.rblinker` |
| Wycieraczki +/- / poziom 0–4 | `wipers`, `wipersback`, `wipers0..4` ✅ | press | `truck.wipers` |
| Silnik start/stop | `engine` ✅ | press | `truck.engine.enabled` |
| Elektryka | `electricity` ⚠️ | press | `truck.electric.enabled` |
| Hamulec postojowy | `parkingbrake` ✅ | press | `truck.parking_brake` |
| Hamulec silnikowy | `motorbrake` ⚠️ | press | `truck.motor_brake` |
| Retarder + / - | `retarderup` / `retarderdown` ⚠️ | press | `truck.retarder.level` |
| Tempomat set / + / - / resume | `cruiectrl`, `cruiectrlinc`, `cruiectrldec`, `cruiectrlres` ✅ | press | `truck.cruise_control` |
| Blokada mostu | `difflock` ⚠️ | press | `truck.differential_lock` |
| Oś podnoszona (ciągnik / naczepa) | `liftaxle` / `trailerliftaxle` ⚠️ | press | `truck.lift_axle`, `trailer.lift_axle` |
| Przyczepa zaczep/odczep | `trailer` ⚠️ | press | `trailer.connected` |
| Klakson / pneumatyczny | `horn` ✅ / `airhorn` ✅ | hold | — |
| Kamery 1–8 | `cam1..cam8` ⚠️ (w ETS2LA jako „Camera 1–8”) | press | — |
| Mapa | `showmap` ⚠️ | press | — |
| GPS / Route Advisor (zakładki) | `radvisor`/`navmap` ⚠️ | press | — |
| Screenshot | `screenshot` ⚠️ (jeśli brak → fallback D: klawisz) | press | — |
| Pauza | `pause` ✅ (ETS2LA: „Pause Game”) | press | event `paused` |
| Quickpark | `quickpark` ✅ | press | — |

**Komendy „set state” (pętla zamknięta w bridge):** np. `setLights('low')`. Bridge zna stan z telemetrii i wysyła tyle `light`, ile trzeba, za każdym razem czekając na zmianę stanu (timeout 500 ms, max 3 próby). Dzięki temu UI ma przyciski „Mijania” / „Postojowe” / „Wył.”, a nie tylko „cykl”.

### 2.4 Ryzyka sterowania

| Ryzyko | Prawdop. | Skutek | Mitygacja |
|---|---|---|---|
| Część akcji nie istnieje jako kontrolka semantical | średnie | brak przycisku | generic device w tym samym DLL + jednorazowe przypisanie w grze; ewentualnie fallback SendInput |
| Semantical wymaga jednak włączenia urządzenia w opcjach sterowania | niskie/średnie | 1 krok ręczny | instrukcja w README; spike S1-0 to sprawdza w 1. dzień |
| TMP blokuje plugin wejścia | niskie | brak sterowania w MP | plugin ma osobny przełącznik `input.enabled`; telemetria dalej działa; zapytać TMP przez feedback system |
| Komenda „wisi” (hold) po zerwaniu sieci | średnie | klakson wyje | watchdog 3 s w pluginie + `releaseAll` przy rozłączeniu WS w bridge |
| Kierownica/pad nadpisuje ten sam input w tej klatce | niskie | zgubiony press | press trwa 2–3 klatki; feedback z telemetrii pokazuje, czy się udało |

---

## 3. Komunikacja PC ↔ Yoga

### 3.1 Wybór technologii bridge'a

| Kryterium | **Node.js 24 + TS** | .NET 9 | Rust |
|---|---|---|---|
| Już na PC | ✅ v24.18.0 | ❌ | ❌ |
| Współdzielone typy z frontendem | ✅ ten sam pakiet `@yoga-auto/protocol` | ❌ (codegen) | ❌ (codegen) |
| WebSocket / mDNS / HTTP | `ws`, `bonjour-service`, wbudowany `http` | Kestrel, ok | tokio-tungstenite, mdns-sd |
| Named pipe do pluginu | ✅ `net.connect('\\\\.\\pipe\\…')` | ✅ | ✅ |
| SMTC (media) | addon napi-rs (`@coooookies/windows-smtc-monitor`, prebuilt) albo helper | ✅ natywnie WinRT | ✅ crate `windows` |
| Pojedynczy .exe | Node SEA (`--build-snapshot`/sea) ✅ | ✅ | ✅ |
| Szybkość pracy agentów | najwyższa | średnia | niższa |

**Decyzja: Node 24 + TypeScript.** Jedyny minus to media (SMTC), rozwiązywane osobnym modułem (§5.5).

### 3.2 Odkrywanie i parowanie

| Opcja | Plusy | Minusy |
|---|---|---|
| **Hostname `.local` (mDNS) + bridge serwuje PWA** | Windows 10/11 rozwiązuje `nazwa-pc.local`; bridge ogłasza `_yoga-auto._tcp` | przeglądarka sama nie skanuje mDNS → adres trzeba wpisać raz |
| QR z adresem | wygodne dla telefonów (przyszłość) | Yoga musiałaby skanować kamerą; mało sensu dla laptopa |
| Stały IP (rezerwacja DHCP) | 100% przewidywalne | konfiguracja routera |
| **Windows Mobile Hotspot na PC** | bezpośredni link Wi-Fi bez routera, stały adres `192.168.137.1` | PC potrzebuje karty Wi-Fi |

**Decyzja:** bridge serwuje PWA pod `http://<pc>.local:7420`. Wpisujesz ten adres raz w skrócie kiosku. Service worker cache'uje aplikację, więc UI startuje nawet bez bridge'a i pokazuje „Łączenie…”. **Parowanie PIN-em:** Yoga prosi o parowanie, konsola/tray bridge'a pokazuje 6 cyfr, wpisujesz je dotykiem, bridge wydaje token (32 B, zapisany w `localStorage` i w `%APPDATA%\yoga-auto\devices.json`). QR jest generowany na ekranie bridge'a dla ewentualnego telefonu.

### 3.3 Łącze i budżet opóźnień

| Łącze | Typowe RTT | Jitter | Uwagi |
|---|---|---|---|
| Wi-Fi 5 GHz przez router | 2–6 ms | czasem 20–100 ms (oszczędzanie energii karty) | wyłączyć power saving karty Wi-Fi na Yodze |
| Windows Mobile Hotspot | 2–5 ms | niski | najprostsze „bez routera” |
| Ethernet (adapter USB-C) | < 1 ms | ~0 | najlepsze, kabel w kabinie przeszkadza mniej niż się wydaje |
| Wi-Fi 2.4 GHz | 5–20 ms | wysoki | odradzane |

Budżet **zdarzenie w grze → piksel na Yodze** (Wi-Fi 5 GHz):

| Etap | ms |
|---|---|
| Gra → callback SDK (1 klatka) | 7–16 |
| Plugin → pipe → bridge | < 1 |
| Bridge: coalescing ticka szybkiego kanału (30 Hz → max 33; 60 Hz → max 16) | 0–16 |
| Wi-Fi | 2–6 (p99 ~20) |
| Przeglądarka: parse + render (rAF) | 8–16 |
| **Suma typowa** | **~25–45 ms** ✅ cel < 50 ms |

Kierunek odwrotny (dotyk → akcja w grze): touch → WS (2–6) → bridge (<1) → pipe (<1) → najbliższa klatka (0–16) → widoczny efekt. **~10–30 ms.**

### 3.4 Docinanie ruchu

- **Kanał `fast`** (prędkość, RPM, bieg, tempomat, światła, hamulce, retarder): bridge wysyła snapshot co **33 ms (30 Hz), domyślnie konfigurowalne do 60 Hz**. Tylko pola, które zmieniły się ponad próg (np. speed ±0.05 m/s, rpm ±10). ~150–400 B/ramkę → < 15 kB/s.
- **Kanał `slow`** (paliwo, temperatury, uszkodzenia, nawigacja, czas): **2 Hz**, delta.
- **`config` i `event`**: natychmiast, bez throttlingu (zlecenie, zaczep przyczepy, mandat, ostrzeżenie).
- **Pełny snapshot** przy (re)connect i co 10 s (keyframe), żeby klient po zgubionej delcie się wyrównał.
- JSON wystarczy. Przy tych wolumenach MessagePack nie daje odczuwalnego zysku, a utrudnia debug. Wersja protokołu pozwala go dodać później (`?enc=msgpack`).
- **Backpressure:** jeśli `ws.bufferedAmount` > 64 kB, bridge pomija ramki `fast` (zostawia najnowszą), nigdy nie pomija `event`/`ack`.

---

## 4. Frontend na Yodze

### 4.1 PWA vs natywna

| Kryterium | **PWA w Edge (kiosk)** | Tauri 2 | Electron |
|---|---|---|---|
| Silnik | Chromium (Edge) | **WebView2 = Chromium** | Chromium |
| `backdrop-filter: url(#svg)` (refrakcja) | ✅ | ✅ | ✅ |
| Instalacja na Yodze | brak (Edge jest w systemie) | instalator + Rust toolchain do budowy | instalator ~150 MB |
| Aktualizacja | automatyczna z bridge'a | build + reinstall | build + reinstall |
| Autostart / kiosk | skrót `msedge --kiosk` w Autostarcie | natywnie | natywnie |
| Blokada uśpienia | Screen Wake Lock API ✅ | natywnie | natywnie |
| Dostęp do systemu Yogi | brak (niepotrzebny) | pełny | pełny |

**Decyzja: PWA.** Przejście na Tauri to dzień pracy, bo ten sam bundle działa w WebView2. Zostawiamy to jako furtkę, gdyby kiosk Edge okazał się niewygodny.

### 4.2 Kiosk na Yodze

| Problem | Rozwiązanie |
|---|---|
| Autostart | skrót w `shell:startup`: `msedge.exe --kiosk http://pc.local:7420 --edge-kiosk-type=fullscreen --no-first-run --disable-pinch --overscroll-history-navigation=0` |
| Assigned Access (prawdziwy kiosk) | wymaga Windows **Pro/Enterprise**. Na Home zostaje sam skrót ⚠️ (pytanie do Ciebie) |
| Uśpienie ekranu | `navigator.wakeLock.request('screen')` + plan zasilania „nigdy” na zasilaczu |
| Pasek zadań | ukryty w trybie `fullscreen` kiosku |
| Gesty krawędziowe Windows (swipe z boku) | polityka `AllowEdgeSwipe=0` (rejestr `HKLM\SOFTWARE\Policies\Microsoft\Windows\EdgeUI`); zmiana ręczna przez Ciebie |
| Pinch-zoom / double-tap zoom | `--disable-pinch`, `<meta viewport user-scalable=no>`, `touch-action: manipulation` |
| Scroll / bounce / pull-to-refresh | `overscroll-behavior: none`, `touch-action: none` na dragowalnych elementach |
| Menu kontekstowe przy długim tapnięciu | `contextmenu` → `preventDefault`, `user-select: none`, `-webkit-touch-callout: none` |
| Tryb tabletu Yogi (360°) | UI responsywne 1920×1080 i 1080×1920 ⚠️ rozdzielczość Twojej Yogi do potwierdzenia |

### 4.3 Liquid Glass na webie

**Technika (Chromium):**
1. **Blur + saturacja tła:** `backdrop-filter: blur(var(--glass-blur)) saturate(180%)`.
2. **Refrakcja:** `backdrop-filter: url(#lg-refract) blur(...)`. Filtr SVG `feImage` (wstępnie wygenerowana mapa przemieszczeń dla zaokrąglonego prostokąta, kanały R/G = wektor normalnej) → `feDisplacementMap scale=…`. **Działa tylko w Chromium** ✅ (Safari ma otwarty bug, Firefox degraduje do blura). Dla nas to bez znaczenia, bo Yoga = Edge.
3. **Specular / odblask krawędzi:** dwie warstwy `box-shadow: inset` + `::before` z `linear-gradient` maskowanym do obramowania (`mask-composite: exclude`) + delikatny „sheen” sterowany kątem (CSS var).
4. **Głębia:** miękki cień zewnętrzny + tint (`background: color-mix(in oklch, var(--tint) 14%, transparent)`).

**Ograniczenia, o których trzeba pamiętać:**
- Mapa przemieszczeń jest zależna od rozmiaru. Generujemy ją w canvasie per rozmiar komponentu i cache'ujemy (klucz: `w×h×r`). Działa dla prostokątów z zaokrągleniami i kół. Dowolne kształty odpadają.
- Wyścig hydratacji: jeśli CSS odwoła się do `#filter` zanim SVG trafi do DOM, Chromium miga przezroczystością. Rozwiązanie: definicje filtrów w `index.html`, a nie w React.
- `backdrop-filter` przelicza się, gdy **zmienia się to, co pod spodem**. **Zasada: szybko zmieniające się treści (wskazówki, liczby) leżą NA szkle, nigdy POD szkłem.** Tło (tapeta / mapa) jest statyczne lub wolnozmienne.

**Wydajność iGPU (cel 60 fps).** Tryby:

| Tryb | Blur | Refrakcja | Specular | Maks. warstw ze szkłem | Kiedy |
|---|---|---|---|---|---|
| `ultra` | 24 px | ✅ | animowany | 8 | mocne iGPU (Iris Xe / Arc) |
| `high` (domyślny) | 20 px | ✅ tylko dock + sheet | statyczny | 6 | |
| `lite` | 10 px | ❌ | statyczny | 4 | p95 klatki > 18 ms |
| `flat` | 0 (brak `backdrop-filter`) | ❌ | gradient | ∞ | p95 > 22 ms albo oszczędzanie baterii |

**Auto-degradacja:** `FrameMonitor` mierzy `requestAnimationFrame` w oknach 2 s. p95 > próg przez 2 okna → tryb niżej. p95 < 12 ms przez 30 s → tryb wyżej (histereza; max 1 podniesienie na 5 min). Plus ręczny przełącznik w Ustawieniach. Dodatkowo `navigator.getBattery()` < 20% i brak ładowania → max `lite`.

**Animacje sprężynowe:** biblioteka `motion` (dawne framer-motion, wspiera springi i WAAPI). Animujemy wyłącznie `transform`/`opacity`, **nigdy `blur` ani wymiarów szkła** (wymiar = nowa mapa przemieszczeń).

### 4.4 Framework UI

| | **React 19 + Vite** | SolidJS | Svelte 5 |
|---|---|---|---|
| Wydajność przy 60 Hz danych | ok, jeśli szybkie dane idą przez refy/sygnały poza re-renderem | ✅ najlepsza (fine-grained) | ✅ bardzo dobra |
| MapLibre, motion, ekosystem | ✅ | 🟡 | 🟡 |
| Znajomość przez agentów | ✅ | 🟡 | ✅ |

**Decyzja: React 19 + Vite + TypeScript**, z twardą regułą: szybki kanał telemetrii czyta się przez `useFastValue(selector)`. Ten hook subskrybuje store poza Reactem i aktualizuje DOM / CSS vars w `requestAnimationFrame`, bez setState na każdą ramkę. Wolne dane idą przez `useSyncExternalStore`.

---

## 5. Funkcje

### 5.1 Etapy

| Etap | Zakres |
|---|---|
| **MVP (M1–M3)** | Home w stylu CarPlay (dock + kafle) · Zegary (prędkość, RPM, bieg, paliwo/zasięg, tempomat, limit) · Nawigacja/zlecenie (dystans, ETA, cargo, trasa A→B, termin, zarobek) · Panel sterowania (wszystkie akcje z §2.3 ze stanem) · Ostrzeżenia (toasty iOS) · Media (play/pause/next/prev + tytuł/okładka) · Ustawienia (jednostki, motyw, tryb wydajności, jasność) |
| **M4** | Mapa świata z pozycją ciężarówki (truckermudgeon/maps) · Komputer pokładowy (spalanie chwilowe/średnie, statystyki trasy, historia zleceń w IndexedDB) · Edytor układu widgetów (drag & drop) · Tryb nocny automatyczny wg czasu w grze |
| **Później** | Trasa na mapie (route z gry nie jest w SDK ⚠️, liczyć samemu z grafu dróg truckermudgeon), integracja ze Spotify Web API (okładki HQ, playlisty), telefon jako drugi ekran, ATS |

### 5.2 Mapa — ocena kosztu

| Opcja | Stan | Koszt | Uwagi |
|---|---|---|---|
| **truckermudgeon/maps** | commit **2026-11-21** (Iceland DLC), ETS2 od 2026-05, PMTiles + MapLibre, ma „TruckSim Navigator” | **M** (generacja kafli raz: parser czyta pliki gry + tippecanoe; potem MapLibre + marker z `truck.world.placement`) | **GPL-3.0**. Używanie wygenerowanych danych prywatnie jest ok; włączenie ich kodu do repo = GPL całości |
| dariowouters/ts-map | commit **2026-11-10**, „Support for 1.59”, eksport tiled web map (raster) | S–M | MIT; raster, mniej ostre na dotyku; brak 1.6x potwierdzone |
| Własny parser | — | **XL** | nie ma sensu |

**Decyzja:** M4, truckermudgeon/maps jako **zewnętrzne narzędzie** do wygenerowania PMTiles (skrypt w `tools/map/`, nie kopiujemy kodu). Konwersja współrzędnych gry na kafle jest w ich kodzie, więc trzeba ją przepisać lub wykorzystać zgodnie z GPL. ⚠️ Decyzja licencyjna (pytanie do Ciebie).

### 5.3 Ostrzeżenia (reguły w bridge, nie w UI, żeby działały też na kilku klientach)

| Alert | Warunek | Poziom |
|---|---|---|
| Niskie paliwo | `truck.fuel.warning` lub zasięg < 100 km | warning |
| AdBlue | `truck.adblue.warning` | warning |
| Ciśnienie powietrza | `air.pressure.warning` / `emergency` | warning / critical |
| Uszkodzenie | wzrost wear o ≥ 2 pp w < 5 s (kolizja) lub wear > 50% | info / warning |
| Zmęczenie | `rest.stop` < 60 min / < 15 min / 0 | info / warning / critical |
| Przekroczenie prędkości | speed > limit + 5 km/h przez > 3 s | warning (dźwięk opcjonalny) |
| Temperatura / olej / akumulator | flagi warning z SDK | warning |
| Mandat / myto / prom | gameplay events | info |

### 5.4 Komputer pokładowy

Bridge liczy trip A/B (dystans z `truck.odometer`, paliwo z różnicy `truck.fuel` z korektą na tankowanie, czas jazdy, średnia prędkość). Statystyki zapisuje w `%APPDATA%\yoga-auto\trips.jsonl`.

### 5.5 Muzyka (SMTC / Spotify)

| Opcja | Odczyt (tytuł, okładka, stan) | Sterowanie | Koszt | Uwagi |
|---|---|---|---|---|
| **WinRT SMTC przez helper .exe** (C#/.NET lub Rust, stdout JSON) | ✅ pełny, w tym okładka | ✅ play/pause/next/prev/seek | M | najpewniejsze; działa ze Spotify, przeglądarką, Winampem itd. |
| `@coooookies/windows-smtc-monitor` (napi-rs, prebuilt) | ✅ | ⚠️ (monitor; sterowanie do sprawdzenia) | S | Win10 1809+; Electron radzi uruchamiać w Workerze |
| NodeRT `@nodert-win11/windows.media.control` | ✅ | ✅ | M | wymaga kompilacji node-gyp, projekt NodeRT mało aktywny |
| Klawisze multimedialne (SendInput VK_MEDIA_*) | ❌ | ✅ | S | fallback sterowania |
| Spotify Web API | ✅ | ✅ (Premium) | M | wymaga konta + OAuth + internetu → **sprzeczne z „bez chmury”**, tylko opcja |

**Decyzja:** strumień 6 zaczyna od spike'a `windows-smtc-monitor`. Jeśli sterowanie nie działa, robi mały helper w Rust (`windows` crate, prebuilt .exe w repo releases) z protokołem JSON-lines. Fallback sterowania: klawisze multimedialne.

---

## 6. Narzędzia deweloperskie

| Narzędzie | Opis | Faza |
|---|---|---|
| **Mock telemetrii** (`tools/mock`) | generator scenariuszy: jazda autostradą, miasto, tempomat, światła nocą, niskie paliwo, kolizja, zlecenie start → delivered. Mówi **dokładnie tym samym protokołem WS co bridge** (to ten sam pakiet `bridge` z `TelemetrySource = Mock`). Przyjmuje komendy i symuluje ich skutek (np. `light` przełącza stan) | 0 (lead) |
| **Recorder / replayer** | bridge zapisuje strumień `fast/slow/config/event` do `.yarec` (JSONL + gzip, znaczniki czasu). Replayer odtwarza ze zmienną prędkością i pętlą | 1 (QA) |
| **Fake pipe** | proces udający plugin na named pipe (do testów bridge'a bez gry) | 1 (QA) |
| Testy kontraktu | ten sam zestaw fixture'ów JSON walidowany w TS (vitest), w bridge'u i w C++ (doctest) | 1 |
| Testy komponentów | Vitest + Testing Library, Storybook/Ladle dla glass-ui | 1 |
| Benchmark fps | Playwright + CDP `Performance.getMetrics`/tracing na scenie „dashboard pod obciążeniem 60 Hz” dla każdego trybu glass; wynik w CI jako artefakt; na Yodze uruchamiany ręcznie (`?bench=1`) | 1 |

---

## 7. Ryzyka (zbiorczo)

| # | Ryzyko | P | Wpływ | Mitygacja |
|---|---|---|---|---|
| R1 | Semantical input nie pokrywa części akcji / wymaga konfiguracji | **N** (wszystkie mixy obecne w controls.sii, SDK: „no binding UI”) | Ś | spike S1-0 w dniu 1; generic device jako plan B |
| R2 | Plugin crashuje grę (bug w DLL) | Ś | W | zero alokacji/IO na wątku gry, wszystko przez lock-free ring + wątek roboczy; issue RenCloud #128 (podwójny shutdown) jako ostrzeżenie; testy start/stop/reload |
| R3 | Aktualizacja ETS2 zmienia API | N | Ś | plugin negocjuje wersję API, loguje brakujące kanały i działa dalej |
| R4 | iGPU Yogi nie trzyma 60 fps z refrakcją | Ś | Ś | tryby `high/lite/flat` + auto-degradacja; benchmark w M3 |
| R5 | Jitter Wi-Fi | Ś | N | 5 GHz / hotspot / kabel; interpolacja wskazówek po stronie UI (spring) |
| R6 | TMP i input plugin | N | Ś | przełącznik `input.enabled`; zapytanie do TMP |
| R7 | Licencje GPL (ETS2LA, truckermudgeon) | Ś | N | nie kopiujemy kodu, tylko wzorce i narzędzia zewnętrzne; decyzja licencji repo |
| R8 | Kiosk na Windows Home bez Assigned Access | W | N | skrót Edge `--kiosk` + ręczne polityki gestów |
| R9 | VS Build Tools / CMake na PC | — | — | instrukcja instalacji (ręcznie) |

## 8. Rzeczy niepewne (do spike'ów)

1. ~~Pełna lista nazw kontrolek semantical~~ ✅ rozwiązane (controls.sii, 297 mixów).
2. ~~Czy semantical działa bez bindowania~~ ✅ tak, według nagłówka SDK. Zostaje test w grze (S1-0).
3. Czy TruckersMP ładuje pluginy z `bin\win_x64\plugins` (pluginy job-trackerów sugerują, że tak) i czy input działa w MP. **S1-0, ręcznie**
4. Jednostka `truck.navigation.time` (sekundy realne vs gry). **S1**
5. Czy `windows-smtc-monitor` umie sterować (a nie tylko czytać). **S6-0**
6. ~~Model Yogi~~ ✅ Lenovo 83JR = **Yoga 7 2-in-1 14AKP10** (AMD Ryzen AI 5 340 / AI 7 350, iGPU Radeon 840M/860M RDNA 3.5, 14″ 1920×1200 dotyk, 360°), **Windows 11 Home**. Dokładny wariant CPU/GPU niepotwierdzony.

## Źródła

- SCS Modding Wiki, Telemetry SDK: https://modding.scssoft.com/wiki/Documentation/Engine/SDK/Telemetry
- SCS blog, ETS2 1.62: https://blog.scssoft.com/2026/11/euro-truck-simulator-2-162-update.html
- RenCloud/scs-sdk-plugin: https://github.com/RenCloud/scs-sdk-plugin (releases, issues #119, #126, #128)
- truckermudgeon/scs-sdk-plugin: https://github.com/truckermudgeon/scs-sdk-plugin
- kniffen/TruckSim-Telemetry: https://github.com/kniffen/TruckSim-Telemetry
- Funbit/ets2-telemetry-server: https://github.com/Funbit/ets2-telemetry-server
- ETS2LA/controller (scs-sdk-controller): https://github.com/ETS2LA/scs-sdk-controller, `docs/CONTROLS.md`
- SCS forum, „What is semantical for?”: https://forum.scssoft.com/viewtopic.php?t=333985
- Rust `scs-sdk-sys`: https://docs.rs/scs-sdk-sys/latest/scs_sdk_sys/all.html
- TruckersMP rules: https://truckersmp.com/rules · Ray Anti-Cheat: https://truckersmp.com/blog/350
- ViGEmBus EOL: https://docs.nefarius.at/projects/ViGEm/End-of-Life/ · vJoy forks: https://github.com/njz3/vJoy/issues/11
- Liquid Glass na webie: https://frontendmasters.com/blog/?p=6644, https://medium.com/ekino-france/liquid-glass-in-css-and-svg-839985fcb88d, https://bugs.webkit.org/show_bug.cgi?id=245510
- SMTC: https://learn.microsoft.com/en-us/uwp/api/windows.media.control.globalsystemmediatransportcontrolssessionmanager, https://www.pkgstats.com/pkg:@coooookies/windows-smtc-monitor
- Mapy: https://github.com/truckermudgeon/maps, https://github.com/dariowouters/ts-map
