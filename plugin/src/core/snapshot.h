#pragma once
// Snapshot telemetrii: POD kopiowany co klatkę przez TripleBuffer (wątek gry → wątek IO).
#include <scssdk_value.h>

#include <cstdint>
#include <string>
#include <vector>

namespace yoga {

/// 58 kanałów prostych + 5×10 przyczep = 108; zapas na rozszerzenia kontraktu.
constexpr uint32_t kMaxSlots = 192;

struct Snapshot {
    uint64_t frame = 0;       // licznik frame_end
    int64_t simTime = 0;      // µs, frame_start.simulation_time
    int64_t renderTime = 0;   // µs, frame_start.render_time
    uint32_t paused = 1;      // gra startuje w pauzie, do eventu "started"
    uint32_t count = 0;       // liczba slotów
    scs_value_t values[kMaxSlots]{};  // type == SCS_VALUE_TYPE_INVALID → jeszcze brak wartości
};

/// Zarejestrowane kanały (indeks slotu = indeks w wektorze). Budowane w init, potem tylko do odczytu.
struct SlotTable {
    std::vector<std::string> names;  // klucz w `tel.ch`, np. "trailer.0.connected"
    std::vector<scs_value_type_t> types;
};

}  // namespace yoga
