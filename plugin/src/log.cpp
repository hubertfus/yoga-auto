#include "log.h"

#include <windows.h>
#include <shlobj.h>

#include <cstdarg>
#include <cstdio>
#include <ctime>
#include <mutex>

namespace yoga {
namespace {
std::mutex g_mutex;
FILE* g_file = nullptr;
}  // namespace

void log_open() {
    std::lock_guard lock(g_mutex);
    if (g_file) return;
    PWSTR docs = nullptr;
    if (SUCCEEDED(SHGetKnownFolderPath(FOLDERID_Documents, 0, nullptr, &docs))) {
        wchar_t path[MAX_PATH];
        swprintf_s(path, L"%s\\Euro Truck Simulator 2\\yoga-auto.log", docs);
        _wfopen_s(&g_file, path, L"a, ccs=UTF-8");
        CoTaskMemFree(docs);
    }
}

void log_close() {
    std::lock_guard lock(g_mutex);
    if (g_file) fclose(g_file);
    g_file = nullptr;
}

void logf(const char* level, const char* fmt, ...) {
    std::lock_guard lock(g_mutex);
    if (!g_file) return;
    char msg[1024];
    va_list args;
    va_start(args, fmt);
    vsnprintf(msg, sizeof msg, fmt, args);
    va_end(args);
    std::time_t now = std::time(nullptr);
    std::tm tm{};
    localtime_s(&tm, &now);
    fprintf(g_file, "%04d-%02d-%02d %02d:%02d:%02d [%s] %s\n", tm.tm_year + 1900, tm.tm_mon + 1, tm.tm_mday, tm.tm_hour,
            tm.tm_min, tm.tm_sec, level, msg);
    fflush(g_file);
}
}  // namespace yoga
