#pragma once
// Logika jednego połączenia IPC po stronie pluginu, niezależna od transportu (named pipe wpina się w pipe_server.cpp).
// Działa wyłącznie w wątku IO. Testy podstawiają własny Sender i sztuczny zegar.
#include <cstdint>
#include <functional>
#include <map>
#include <memory>
#include <string>
#include <string_view>
#include <unordered_map>

#include "core.h"
#include "ipc_msgs.h"

namespace yoga {

class IpcSession {
public:
    /// Wysyła już zaramkowane bajty (jedna lub kilka ramek). false = transport się zepsuł.
    using Sender = std::function<bool(const std::string& bytes)>;
    /// Zapis do logu pliku (poziom, treść). Wołane z wątku IO.
    using LogSink = std::function<void(std::string_view level, std::string_view msg)>;

    IpcSession(Core& core, HelloInfo hello, Sender send, LogSink log);

    /// Zmiana danych hello (np. dojście wersji input API) — jeśli klient podłączony, wyśle nowe hello.
    void update_hello(const HelloInfo& h);

    void on_connect(uint64_t nowMs);
    void on_disconnect(uint64_t nowMs);
    bool connected() const { return connected_; }

    /// Główna pompa: zdarzenia z gry, ack-i, telemetria. Wołać po każdym wybudzeniu i co ≤ wait_ms().
    void pump(uint64_t nowMs);

    /// Obsługa jednej ramki od bridge'a (payload JSON bez nagłówka).
    void on_payload(std::string_view payload, uint64_t nowMs);

    /// Log z wątku IO do przekazania bridge'owi (poziom ≥ info).
    void send_log(std::string_view level, std::string_view msg);

    /// Ile ms najwyżej czekać do następnego pump (throttling `tel`, inaczej 50).
    uint32_t wait_ms(uint64_t nowMs) const;

    bool send_failed() const { return failed_; }

    // Podgląd — testy.
    const std::map<std::string, EventRecord>& configs() const { return configs_; }

private:
    void drain_events();
    void drain_acks();
    void pump_tel(uint64_t nowMs);
    void frame(const std::string& payload);
    void flush();

    Core& core_;
    HelloInfo hello_;
    Sender send_;
    LogSink log_;
    std::unordered_map<std::string, uint32_t> semIdx_, genIdx_;

    bool connected_ = false;
    bool failed_ = false;
    bool helloDirty_ = false;
    bool telDirty_ = false;
    bool haveSent_ = false;
    uint64_t lastTelMs_ = 0;
    std::string out_;
    std::string scratch_;
    std::map<std::string, EventRecord> configs_;  // ostatnie niepuste cfg per id
    int activeState_[2] = {-1, -1};                // -1 nieznane, 0/1; [0]=semantical [1]=generic
    std::unique_ptr<Snapshot> sent_;               // ostatnio wysłany snapshot (do diffu)
};

}  // namespace yoga
