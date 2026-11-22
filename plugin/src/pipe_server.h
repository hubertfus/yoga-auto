#pragma once
// Serwer named pipe `\\.\pipe\yoga-auto` (1 klient naraz, overlapped IO, ACL: bieżący użytkownik,
// PIPE_REJECT_REMOTE_CLIENTS). Cały IO i serializacja JSON dzieją się w jednym wątku — wątek gry tylko woła
// SetEvent przez Core::set_wake.
#include <atomic>
#include <memory>
#include <mutex>
#include <thread>

#include "core.h"
#include "ipc_msgs.h"

namespace yoga {

class PipeServer {
public:
    PipeServer(Core& core, HelloInfo hello);
    ~PipeServer();
    PipeServer(const PipeServer&) = delete;
    PipeServer& operator=(const PipeServer&) = delete;

    void start();
    /// Idempotentne. Blokuje do końca wątku IO.
    void stop();
    /// Aktualizacja danych hello (np. po scs_input_init). Bezpieczne z dowolnego wątku.
    void update_hello(const HelloInfo& h);

private:
    struct Impl;
    std::unique_ptr<Impl> impl_;
};

}  // namespace yoga
