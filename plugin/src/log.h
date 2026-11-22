#pragma once
// Log pluginu: %USERPROFILE%\Documents\Euro Truck Simulator 2\yoga-auto.log (+ kopia do bridge'a jako t:"log").
// logf() bierze mutex i robi IO — wolno z init/shutdown i wątku IO, NIE z callbacków gry (tam Core::game_log).
#include <string>
#include <utility>
#include <vector>

namespace yoga {
/// Katalog "Documents\Euro Truck Simulator 2" (bez końcowego backslasha); pusty, gdy nieznany.
std::wstring game_docs_dir();

void log_open();
void log_close();
void logf(const char* level, const char* fmt, ...);
/// Tylko do pliku (bez kopii dla bridge'a) — dla logów, które sesja IPC przekazała sama.
void log_file_only(const char* level, const char* msg);

/// Wątek IO włącza przekazywanie logów (poziom ≥ info) do kolejki, którą opróżnia log_take_forward().
void log_forward_enable(bool on);
void log_take_forward(std::vector<std::pair<std::string, std::string>>& out);
}  // namespace yoga
