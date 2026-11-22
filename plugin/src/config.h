#pragma once
// Konfiguracja użytkownika: %USERPROFILE%\Documents\Euro Truck Simulator 2\yoga-auto.ini
//   inputEnabled=0        ; twarda blokada inputu (TruckersMP) — plugin nie rejestruje urządzeń, bridge jej nie zdejmie
//   telMinIntervalMs=8    ; min. odstęp ramek tel (0 = każda klatka)
//   inputRepeat=1         ; diagnostyka: powtarzaj wartość wejścia co klatkę
#include <cstdint>
#include <string>
#include <string_view>

namespace yoga {

struct IniSettings {
    bool inputEnabled = true;
    uint32_t telMinIntervalMs = 0;
    bool inputRepeat = false;
};

/// Czysty parser (testowalny): "klucz=wartość", komentarze `;` i `#`, wielkość liter kluczy bez znaczenia.
IniSettings parse_ini(std::string_view text);

/// Wczytuje plik z katalogu Documents; brak pliku = ustawienia domyślne.
IniSettings load_ini();

}  // namespace yoga
