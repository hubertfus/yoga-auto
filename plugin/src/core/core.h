#pragma once
// Rdzeń pluginu: stan współdzielony między wątkiem gry (callbacki SDK) a wątkiem IO.
// Bez zależności od windows.h — testowalny na sztucznych klatkach.
//
// Zasady wątku gry (callbacki): zero alokacji, zero locków blokujących, zero IO.
// Komunikacja: TripleBuffer (snapshot), SpscByteRing (cfg/evt/log/input.active), SpscQueue (komendy / ack).
#include <atomic>
#include <cstdint>
#include <memory>
#include <string>
#include <vector>

#include "events.h"
#include "input_device.h"
#include "snapshot.h"
#include "spsc.h"

namespace yoga {

struct CoreConfig {
    bool inputLocked = false;      // twarda blokada z yoga-auto.ini (TruckersMP): opts jej nie zdejmie
    bool inputEnabled = true;
    uint32_t telMinIntervalMs = 0;
    InputTuning tuning{};
    std::vector<std::string> semantical;  // nazwy wejść (kolejność = indeks wejścia w SDK)
    std::vector<std::string> generic;
};

class Core {
public:
    static constexpr size_t kEventRingBytes = 1u << 20;

    explicit Core(CoreConfig cfg);

    /// Rejestruje slot telemetrii. Tylko przed startem callbacków. Zwraca indeks slotu albo -1 (limit).
    int add_slot(std::string name, scs_value_type_t type);
    const SlotTable& slots() const { return slots_; }

    // ───────────── wątek gry ─────────────
    void on_channel(uint32_t slot, const scs_value_t* v) noexcept;
    void on_frame_start(uint32_t flags, int64_t renderTimeUs, int64_t simTimeUs) noexcept;
    void on_frame_end() noexcept;
    void on_paused(bool paused) noexcept;
    void on_config(const char* id, const scs_named_value_t* attrs) noexcept;
    void on_gameplay(const char* id, const scs_named_value_t* attrs) noexcept;
    void game_log(const char* level, const char* fmt, ...) noexcept;

    void on_input_active(bool generic, bool active) noexcept;
    /// input_event_callback. Zwraca true, gdy wypełniono (index, value).
    bool on_input_event(bool generic, bool firstInFrame, bool firstAfterActivation, uint64_t nowMs, uint32_t& index,
                        bool& value) noexcept;

    // ───────────── wątek IO ─────────────
    /// Wątek IO sprawdza po wybudzeniu. true = jest nowy snapshot w latest().
    bool poll_snapshot();
    const Snapshot& latest() const { return latest_; }
    SpscByteRing<kEventRingBytes>& events() { return events_; }
    AckQueue& acks() { return acks_; }
    InputDevice& device(bool generic) { return generic ? *generic_ : *semantical_; }
    bool has_generic() const { return generic_ != nullptr; }

    void set_wake(void (*fn)(void*), void* ctx) {
        wakeFn_ = fn;
        wakeCtx_ = ctx;
    }

    std::atomic<uint64_t> lastHbMs{0};
    std::atomic<uint64_t> frame{0};
    std::atomic<bool> inputEnabled;
    std::atomic<uint32_t> telMinIntervalMs;
    std::atomic<uint64_t> droppedEvents{0};

    bool input_locked() const { return cfg_.inputLocked; }
    const CoreConfig& config() const { return cfg_; }

private:
    void wake() noexcept {
        if (wakeFn_) wakeFn_(wakeCtx_);
    }

    CoreConfig cfg_;
    SlotTable slots_;
    Snapshot work_;
    TripleBuffer<Snapshot> snap_;
    Snapshot latest_;
    SpscByteRing<kEventRingBytes> events_;
    AckQueue acks_;
    std::unique_ptr<InputDevice> semantical_;
    std::unique_ptr<InputDevice> generic_;
    void (*wakeFn_)(void*) = nullptr;
    void* wakeCtx_ = nullptr;
};

}  // namespace yoga
