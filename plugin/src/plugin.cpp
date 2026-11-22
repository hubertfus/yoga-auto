// yoga-auto — plugin SCS SDK (ETS2/ATS): telemetria + urządzenie wejściowe semantical + serwer named pipe.
// Ten plik to tylko klej SDK ↔ Core. Logika jest w src/core (testowana bez gry).
#include <windows.h>
#include <winver.h>

#include <scssdk_input.h>
#include <scssdk_telemetry.h>
#include <eurotrucks2/scssdk_eut2.h>
#include <eurotrucks2/scssdk_input_eut2.h>
#include <eurotrucks2/scssdk_telemetry_eut2.h>
#include <amtrucks/scssdk_ats.h>
#include <amtrucks/scssdk_input_ats.h>
#include <amtrucks/scssdk_telemetry_ats.h>

#include <atomic>
#include <cstdio>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

#include "actions.gen.h"
#include "channels.gen.h"
#include "config.h"
#include "core.h"
#include "log.h"
#include "pipe_server.h"

namespace {

using yoga::Core;

uint64_t now_ms() { return GetTickCount64(); }

std::string version_string(scs_u32_t v) {
    char b[16];
    snprintf(b, sizeof b, "%u.%02u", SCS_GET_MAJOR_VERSION(v), SCS_GET_MINOR_VERSION(v));
    return b;
}

/// Wersja gry z zasobów exe (np. "1.62"); pusta, gdy się nie da.
std::string host_exe_version() {
    wchar_t path[MAX_PATH];
    if (!GetModuleFileNameW(nullptr, path, MAX_PATH)) return {};
    DWORD dummy = 0;
    const DWORD size = GetFileVersionInfoSizeW(path, &dummy);
    if (!size) return {};
    std::vector<BYTE> data(size);
    if (!GetFileVersionInfoW(path, 0, size, data.data())) return {};
    VS_FIXEDFILEINFO* ffi = nullptr;
    UINT len = 0;
    if (!VerQueryValueW(data.data(), L"\\", reinterpret_cast<LPVOID*>(&ffi), &len) || !ffi) return {};
    char b[32];
    snprintf(b, sizeof b, "%u.%u", HIWORD(ffi->dwFileVersionMS), LOWORD(ffi->dwFileVersionMS));
    return b;
}

struct SlotCtx {
    Core* core;
    uint32_t slot;
};

struct Plugin {
    yoga::IniSettings ini;
    std::unique_ptr<Core> core;
    std::unique_ptr<yoga::PipeServer> pipe;
    std::vector<SlotCtx> slotCtx;  // stabilne adresy dla callbacków kanałów
    yoga::HelloInfo hello;
    // zestaw wejść rejestrowany w SDK (puste, gdy input zablokowany w ini)
    std::vector<scs_input_device_input_t> semInputs;
    bool inputRegistered = false;
};

std::mutex g_mx;                       // tylko init/shutdown
std::unique_ptr<Plugin> g_plugin;      // żyje od pierwszego init do ostatniego shutdown
std::atomic<Core*> g_core{nullptr};    // czytane z callbacków gry
bool g_telemetryActive = false;
bool g_inputActive = false;

yoga::CoreConfig make_core_config(const yoga::IniSettings& ini) {
    yoga::CoreConfig c;
    c.inputLocked = !ini.inputEnabled;
    c.inputEnabled = ini.inputEnabled;
    c.telMinIntervalMs = ini.telMinIntervalMs;
    c.tuning.pressFrames = yoga::gen::kPressFrames;
    c.tuning.watchdogMs = yoga::gen::kHoldWatchdogMs;
    c.tuning.repeatEachFrame = ini.inputRepeat;
    if (ini.inputEnabled) {
        for (unsigned i = 0; i < yoga::gen::kSemanticalInputCount; ++i) c.semantical.emplace_back(yoga::gen::kSemanticalInputs[i]);
        for (unsigned i = 0; i < yoga::gen::kGenericInputCount; ++i) c.generic.emplace_back(yoga::gen::kGenericInputs[i]);
    }
    return c;
}

/// Tworzy Plugin przy pierwszym init (telemetry albo input — kolejność wywołań nie jest gwarantowana).
Plugin& ensure_plugin(const scs_sdk_init_params_v100_t& common) {
    if (g_plugin) return *g_plugin;
    yoga::log_open();
    auto p = std::make_unique<Plugin>();
    p->ini = yoga::load_ini();
    p->core = std::make_unique<Core>(make_core_config(p->ini));
    p->hello.pluginVersion = YOGA_PLUGIN_VERSION;
    p->hello.gameId = common.game_id ? common.game_id : "";
    p->hello.gameName = common.game_name ? common.game_name : "";
    p->hello.gameVersion = host_exe_version();
    p->hello.inputEnabled = p->core->inputEnabled.load();
    p->hello.semantical = p->core->config().semantical;
    p->hello.generic = p->core->config().generic;
    p->slotCtx.reserve(yoga::kMaxSlots);
    g_plugin = std::move(p);
    return *g_plugin;
}

void start_pipe_if_needed(Plugin& p) {
    if (p.pipe) return;
    p.pipe = std::make_unique<yoga::PipeServer>(*p.core, p.hello);
    p.pipe->start();
}

void teardown_if_idle() {
    if (g_telemetryActive || g_inputActive || !g_plugin) return;
    g_core.store(nullptr);
    if (g_plugin->pipe) g_plugin->pipe->stop();
    yoga::logf("info", "plugin zatrzymany");
    g_plugin.reset();
    yoga::log_close();
}

// ───────────────────────── telemetria: callbacki (wątek gry) ─────────────────────────

SCSAPI_VOID on_channel(const scs_string_t, const scs_u32_t, const scs_value_t* const value, const scs_context_t ctx) {
    const auto* c = static_cast<const SlotCtx*>(ctx);
    c->core->on_channel(c->slot, value);
}

SCSAPI_VOID on_event(const scs_event_t event, const void* const info, const scs_context_t ctx) {
    auto* core = static_cast<Core*>(ctx);
    switch (event) {
        case SCS_TELEMETRY_EVENT_frame_start: {
            const auto* fs = static_cast<const scs_telemetry_frame_start_t*>(info);
            core->on_frame_start(fs->flags, static_cast<int64_t>(fs->render_time), static_cast<int64_t>(fs->simulation_time));
            break;
        }
        case SCS_TELEMETRY_EVENT_frame_end: core->on_frame_end(); break;
        case SCS_TELEMETRY_EVENT_paused: core->on_paused(true); break;
        case SCS_TELEMETRY_EVENT_started: core->on_paused(false); break;
        case SCS_TELEMETRY_EVENT_configuration: {
            const auto* c = static_cast<const scs_telemetry_configuration_t*>(info);
            core->on_config(c->id, c->attributes);
            break;
        }
        case SCS_TELEMETRY_EVENT_gameplay: {
            const auto* g = static_cast<const scs_telemetry_gameplay_event_t*>(info);
            core->on_gameplay(g->id, g->attributes);
            break;
        }
        default: break;
    }
}

// ───────────────────────── input: callbacki (wątek gry) ─────────────────────────

SCSAPI_VOID on_input_active(const scs_u8_t active, const scs_context_t ctx) {
    if (Core* core = g_core.load()) core->on_input_active(ctx != nullptr, active != 0);
}

SCSAPI_RESULT on_input_event(scs_input_event_t* const ev, const scs_u32_t flags, const scs_context_t ctx) {
    Core* core = g_core.load();
    if (!core) return SCS_RESULT_not_found;
    uint32_t index = 0;
    bool value = false;
    const bool first = (flags & SCS_INPUT_EVENT_CALLBACK_FLAG_first_in_frame) != 0;
    const bool afterAct = (flags & SCS_INPUT_EVENT_CALLBACK_FLAG_first_after_activation) != 0;
    if (!core->on_input_event(ctx != nullptr, first, afterAct, now_ms(), index, value)) return SCS_RESULT_not_found;
    ev->input_index = index;
    ev->value_bool.value = value ? 1 : 0;
    return SCS_RESULT_ok;
}

}  // namespace

// ═════════════════════════════ eksporty SDK ═════════════════════════════

SCSAPI_RESULT scs_telemetry_init(const scs_u32_t version, const scs_telemetry_init_params_t* const params) {
    if (version != SCS_TELEMETRY_VERSION_1_01) return SCS_RESULT_unsupported;
    const auto* sdk = static_cast<const scs_telemetry_init_params_v101_t*>(params);
    // Gra potrafi zawołać init drugi raz bez shutdownu (por. RenCloud #128) — nie rejestrujemy po raz drugi.
    std::lock_guard lock(g_mx);
    if (g_telemetryActive) return SCS_RESULT_ok;

    Plugin& p = ensure_plugin(sdk->common);
    Core& core = *p.core;
    p.hello.apiTelemetry = version_string(sdk->common.game_version);
    if (p.hello.gameVersion.empty()) p.hello.gameVersion = p.hello.apiTelemetry;

    yoga::logf("info", "yoga-auto %s: telemetry init, game=%s (%s), telemetry api %s, ipc v%d", YOGA_PLUGIN_VERSION,
               sdk->common.game_name, sdk->common.game_id, p.hello.apiTelemetry.c_str(), yoga::gen::kIpcVersion);

    // ── eventy ──
    struct Ev {
        scs_event_t e;
        const char* name;
        bool required;
    };
    const Ev events[] = {{SCS_TELEMETRY_EVENT_frame_start, "frame_start", true},
                         {SCS_TELEMETRY_EVENT_frame_end, "frame_end", true},
                         {SCS_TELEMETRY_EVENT_paused, "paused", false},
                         {SCS_TELEMETRY_EVENT_started, "started", false},
                         {SCS_TELEMETRY_EVENT_configuration, "configuration", false},
                         {SCS_TELEMETRY_EVENT_gameplay, "gameplay", false}};
    for (const auto& ev : events) {
        if (sdk->register_for_event(ev.e, on_event, &core) != SCS_RESULT_ok) {
            yoga::logf(ev.required ? "error" : "warn", "nie udało się zarejestrować eventu %s", ev.name);
            if (ev.required) return SCS_RESULT_generic_error;
        }
    }

    // ── kanały (brak kanału w danej wersji gry nie jest błędem) ──
    unsigned missing = 0;
    for (unsigned k = 0; k < yoga::gen::kChannelCount; ++k) {
        const auto& def = yoga::gen::kChannels[k];
        const unsigned n = def.indexCount ? def.indexCount : 1;
        for (unsigned i = 0; i < n; ++i) {
            std::string name = def.name;
            if (def.indexCount) {
                const size_t at = name.find("{i}");
                if (at != std::string::npos) name.replace(at, 3, std::to_string(i));
            }
            if (p.slotCtx.size() >= yoga::kMaxSlots) {
                yoga::logf("error", "za dużo kanałów (limit %u) — pomijam %s", yoga::kMaxSlots, name.c_str());
                ++missing;
                continue;
            }
            p.slotCtx.push_back({&core, static_cast<uint32_t>(core.slots().names.size())});
            const scs_result_t r =
                sdk->register_for_channel(name.c_str(), SCS_U32_NIL, def.type, SCS_TELEMETRY_CHANNEL_FLAG_none, on_channel, &p.slotCtx.back());
            if (r == SCS_RESULT_ok) {
                core.add_slot(name, def.type);
                p.hello.channels.push_back(name);
            } else {
                p.slotCtx.pop_back();
                ++missing;
                yoga::logf("info", "kanał %s niedostępny w tej wersji gry (kod %d) — pomijam", name.c_str(), static_cast<int>(r));
            }
        }
    }
    yoga::logf("info", "zarejestrowano %zu kanałów, pominięto %u", p.hello.channels.size(), missing);

    g_core.store(&core);
    g_telemetryActive = true;
    if (p.pipe) p.pipe->update_hello(p.hello);
    else start_pipe_if_needed(p);
    return SCS_RESULT_ok;
}

SCSAPI_VOID scs_telemetry_shutdown(void) {
    std::lock_guard lock(g_mx);
    if (!g_telemetryActive) return;  // idempotentnie (podwójny shutdown, por. RenCloud #128)
    g_telemetryActive = false;
    yoga::logf("info", "telemetry shutdown");
    teardown_if_idle();
}

SCSAPI_RESULT scs_input_init(const scs_u32_t version, const scs_input_init_params_t* const params) {
    if (version != SCS_INPUT_VERSION_1_00) return SCS_RESULT_unsupported;
    const auto* sdk = static_cast<const scs_input_init_params_v100_t*>(params);
    std::lock_guard lock(g_mx);
    if (g_inputActive) return SCS_RESULT_ok;

    Plugin& p = ensure_plugin(sdk->common);
    Core& core = *p.core;
    p.hello.apiInput = version_string(sdk->common.game_version);
    yoga::logf("info", "input init, input api %s", p.hello.apiInput.c_str());

    if (p.ini.inputEnabled) {
        p.semInputs.clear();
        p.semInputs.reserve(core.config().semantical.size());
        for (const auto& name : core.config().semantical) {
            scs_input_device_input_t in{};
            in.name = name.c_str();  // Core żyje do shutdownu, więc wskaźniki są stabilne
            in.display_name = name.c_str();
            in.value_type = SCS_VALUE_TYPE_bool;
            p.semInputs.push_back(in);
        }

        scs_input_device_t dev{};
        dev.name = "yoga_auto_semantical";
        dev.display_name = "Yoga Auto Semantical";
        dev.type = SCS_INPUT_DEVICE_TYPE_semantical;
        dev.input_count = static_cast<scs_u32_t>(p.semInputs.size());
        dev.inputs = p.semInputs.data();
        dev.callback_context = nullptr;  // nullptr = semantical, niepusty = generic
        dev.input_active_callback = on_input_active;
        dev.input_event_callback = on_input_event;
        if (sdk->register_device(&dev) != SCS_RESULT_ok) {
            yoga::logf("error", "rejestracja urządzenia semantical nieudana — input niedostępny");
            p.hello.inputEnabled = false;
            core.inputEnabled.store(false);
        } else {
            p.inputRegistered = true;
            yoga::logf("info", "urządzenie semantical zarejestrowane (%zu wejść)", p.semInputs.size());
        }
        // Urządzenie generic: dziś brak wejść w kontrakcie (kGenericInputCount == 0) — rejestrowane dopiero, gdy będą.
    } else {
        yoga::logf("warn", "input zablokowany w yoga-auto.ini (inputEnabled=0) — urządzenia nie zostały zarejestrowane");
    }

    g_core.store(&core);
    g_inputActive = true;
    if (p.pipe) p.pipe->update_hello(p.hello);
    else start_pipe_if_needed(p);
    return SCS_RESULT_ok;
}

SCSAPI_VOID scs_input_shutdown(void) {
    std::lock_guard lock(g_mx);
    if (!g_inputActive) return;  // idempotentnie
    g_inputActive = false;
    yoga::logf("info", "input shutdown");
    teardown_if_idle();
}

BOOL APIENTRY DllMain(HMODULE, DWORD, LPVOID) { return TRUE; }
