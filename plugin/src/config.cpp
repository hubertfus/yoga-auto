#include "config.h"

#include <windows.h>

#include <algorithm>
#include <cctype>
#include <charconv>
#include <fstream>
#include <sstream>

#include "log.h"

namespace yoga {

namespace {
std::string_view trim(std::string_view s) {
    while (!s.empty() && std::isspace(static_cast<unsigned char>(s.front()))) s.remove_prefix(1);
    while (!s.empty() && std::isspace(static_cast<unsigned char>(s.back()))) s.remove_suffix(1);
    return s;
}
bool parse_bool(std::string_view v, bool def) {
    std::string l(v);
    std::transform(l.begin(), l.end(), l.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    if (l == "1" || l == "true" || l == "yes" || l == "on") return true;
    if (l == "0" || l == "false" || l == "no" || l == "off") return false;
    return def;
}
}  // namespace

IniSettings parse_ini(std::string_view text) {
    IniSettings s;
    size_t pos = 0;
    while (pos <= text.size()) {
        size_t end = text.find('\n', pos);
        if (end == std::string_view::npos) end = text.size();
        std::string_view line = trim(text.substr(pos, end - pos));
        pos = end + 1;
        if (line.empty() || line[0] == ';' || line[0] == '#' || line[0] == '[') continue;
        if (const size_t sc = line.find(';'); sc != std::string_view::npos) line = trim(line.substr(0, sc));
        const size_t eq = line.find('=');
        if (eq == std::string_view::npos) continue;
        std::string key(trim(line.substr(0, eq)));
        std::transform(key.begin(), key.end(), key.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
        const std::string_view val = trim(line.substr(eq + 1));
        if (key == "inputenabled") {
            s.inputEnabled = parse_bool(val, s.inputEnabled);
        } else if (key == "inputrepeat") {
            s.inputRepeat = parse_bool(val, s.inputRepeat);
        } else if (key == "telmininterval" || key == "telminintervalms") {
            uint32_t n = 0;
            auto r = std::from_chars(val.data(), val.data() + val.size(), n);
            if (r.ec == std::errc{}) s.telMinIntervalMs = n > 1000 ? 1000 : n;
        }
    }
    return s;
}

IniSettings load_ini() {
    const std::wstring dir = game_docs_dir();
    if (dir.empty()) return {};
    std::ifstream f(dir + L"\\yoga-auto.ini", std::ios::binary);
    if (!f) return {};
    std::stringstream ss;
    ss << f.rdbuf();
    return parse_ini(ss.str());
}

}  // namespace yoga
