#pragma once
// Log pluginu: %USERPROFILE%\Documents\Euro Truck Simulator 2\yoga-auto.log
// Bezpieczny do wołania z wątku gry tylko poza gorącą ścieżką (init/shutdown/zdarzenia rzadkie).
namespace yoga {
void log_open();
void log_close();
void logf(const char* level, const char* fmt, ...);
}  // namespace yoga
