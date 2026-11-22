#include "log.h"

#include <windows.h>
#include <shlobj.h>
#include <sys/stat.h>

#include <cstdarg>
#include <cstdio>
#include <cstring>
#include <ctime>
#include <deque>
#include <mutex>

namespace yoga {
namespace {
std::mutex g_mutex;
FILE* g_file = nullptr;
bool g_forward = false;
std::deque<std::pair<std::string, std::string>> g_fwd;
constexpr size_t kFwdCap = 64;
constexpr long long kMaxLogBytes = 2 * 1024 * 1024;
}  // namespace

std::wstring game_docs_dir() {
    PWSTR docs = nullptr;
    std::wstring dir;
    if (SUCCEEDED(SHGetKnownFolderPath(FOLDERID_Documents, 0, nullptr, &docs))) {
        dir = std::wstring(docs) + L"\\Euro Truck Simulator 2";
    }
    CoTaskMemFree(docs);
    return dir;
}

void log_open() {
    std::lock_guard lock(g_mutex);
    if (g_file) return;
    const std::wstring dir = game_docs_dir();
    if (dir.empty()) return;
    const std::wstring path = dir + L"\\yoga-auto.log";
    struct _stat64 st{};
    if (_wstat64(path.c_str(), &st) == 0 && st.st_size > kMaxLogBytes) {
        const std::wstring old = dir + L"\\yoga-auto.old.log";
        MoveFileExW(path.c_str(), old.c_str(), MOVEFILE_REPLACE_EXISTING);
    }
    _wfopen_s(&g_file, path.c_str(), L"a, ccs=UTF-8");
}

void log_close() {
    std::lock_guard lock(g_mutex);
    if (g_file) fclose(g_file);
    g_file = nullptr;
    g_forward = false;
    g_fwd.clear();
}

void log_forward_enable(bool on) {
    std::lock_guard lock(g_mutex);
    g_forward = on;
    if (!on) g_fwd.clear();
}

void log_take_forward(std::vector<std::pair<std::string, std::string>>& out) {
    std::lock_guard lock(g_mutex);
    while (!g_fwd.empty()) {
        out.push_back(std::move(g_fwd.front()));
        g_fwd.pop_front();
    }
}

namespace {
void write_line(const char* level, const char* msg, bool forward) {
    std::lock_guard lock(g_mutex);
    if (forward && g_forward && std::strcmp(level, "debug") != 0 && g_fwd.size() < kFwdCap) g_fwd.emplace_back(level, msg);
    if (!g_file) return;
    std::time_t now = std::time(nullptr);
    std::tm tm{};
    localtime_s(&tm, &now);
    fprintf(g_file, "%04d-%02d-%02d %02d:%02d:%02d [%s] %s\n", tm.tm_year + 1900, tm.tm_mon + 1, tm.tm_mday, tm.tm_hour,
            tm.tm_min, tm.tm_sec, level, msg);
    fflush(g_file);
}
}  // namespace

void logf(const char* level, const char* fmt, ...) {
    char msg[1024];
    va_list args;
    va_start(args, fmt);
    vsnprintf(msg, sizeof msg, fmt, args);
    va_end(args);
    write_line(level, msg, true);
}

void log_file_only(const char* level, const char* msg) { write_line(level, msg, false); }
}  // namespace yoga
