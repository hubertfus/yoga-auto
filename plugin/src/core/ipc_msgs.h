#pragma once
// Serializacja wiadomości plugin → bridge i parser komend bridge → plugin (shared/protocol/src/ipc.ts).
#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

#include "events.h"
#include "snapshot.h"

namespace yoga {

struct HelloInfo {
    std::string pluginVersion;
    std::string gameId;       // "eut2" | "ats"
    std::string gameName;
    std::string gameVersion;  // np. "1.62"
    std::string apiTelemetry; // np. "1.21"
    std::string apiInput;     // "" = brak input API → null
    std::vector<std::string> channels;
    std::vector<std::string> semantical;
    std::vector<std::string> generic;
    bool inputEnabled = true;
};

void build_hello(std::string& out, const HelloInfo& h);

/// Buduje `tel` z różnic cur − prev (prev == nullptr → wszystkie sloty z wartością).
/// Zwraca false, gdy nic się nie zmieniło (i paused bez zmian) — wtedy `out` jest nietknięte.
bool build_tel(std::string& out, const Snapshot& cur, const Snapshot* prev, const SlotTable& slots);

/// Wiadomości zdarzeń: cfg (attrs:null przy pustej konfiguracji), evt, input.active, in.ack, log.
void build_cfg(std::string& out, const EventRecord& e);
void build_evt(std::string& out, const EventRecord& e);
void build_input_active(std::string& out, const std::string& device, bool active);
void build_ack(std::string& out, uint32_t seq, uint64_t frame, bool ok);
void build_log(std::string& out, std::string_view level, std::string_view msg);

// ───────────────────────── komendy bridge → plugin ─────────────────────────

struct Command {
    enum class Type { Invalid, Input, Heartbeat, ReleaseAll, Opts } type = Type::Invalid;
    // Input
    uint32_t seq = 0;
    bool generic = false;  // device: "generic" (false = "semantical")
    std::string input;
    enum class Op { Press, Down, Up, Axis } op = Op::Press;
    // Opts
    bool hasInputEnabled = false;
    bool inputEnabled = true;
    bool hasTelMin = false;
    uint32_t telMinIntervalMs = 0;
};

Command parse_command(std::string_view payload);

}  // namespace yoga
