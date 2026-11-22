// yoga-auto — plugin SCS SDK (ETS2/ATS).
// F0: szkielet — telemetry init loguje grę i wersję API. S1: kanały, input semantical, named pipe (docs/agents/s1-plugin.md).
#include <windows.h>

#include <scssdk_telemetry.h>
#include <eurotrucks2/scssdk_eut2.h>
#include <eurotrucks2/scssdk_telemetry_eut2.h>
#include <amtrucks/scssdk_ats.h>
#include <amtrucks/scssdk_telemetry_ats.h>

#include "actions.gen.h"
#include "channels.gen.h"
#include "log.h"

namespace {
bool g_telemetry_active = false;
}

SCSAPI_RESULT scs_telemetry_init(const scs_u32_t version, const scs_telemetry_init_params_t* const params) {
    if (version != SCS_TELEMETRY_VERSION_1_01) return SCS_RESULT_unsupported;
    if (g_telemetry_active) return SCS_RESULT_ok;  // idempotentnie (sdk reinit)
    const auto* p = static_cast<const scs_telemetry_init_params_v101_t*>(params);

    yoga::log_open();
    yoga::logf("info", "yoga-auto %s: telemetry init, game=%s (%s), game api %u.%u, ipc v%d, %u channels, %u semantical inputs",
               YOGA_PLUGIN_VERSION, p->common.game_name, p->common.game_id,
               SCS_GET_MAJOR_VERSION(p->common.game_version), SCS_GET_MINOR_VERSION(p->common.game_version),
               yoga::gen::kIpcVersion, yoga::gen::kChannelCount, yoga::gen::kSemanticalInputCount);
    p->common.log(SCS_LOG_TYPE_message, "[yoga-auto] plugin loaded (F0 skeleton)");
    g_telemetry_active = true;
    return SCS_RESULT_ok;
}

SCSAPI_VOID scs_telemetry_shutdown(void) {
    if (!g_telemetry_active) return;  // idempotentnie (por. RenCloud #128)
    g_telemetry_active = false;
    yoga::logf("info", "telemetry shutdown");
    yoga::log_close();
}

BOOL APIENTRY DllMain(HMODULE, DWORD, LPVOID) { return TRUE; }
