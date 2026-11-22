#pragma once
// Logika urządzenia wejściowego (semantical / generic) bez zależności od SDK i Windows.
// Wątek IO woła submit(); wątek gry woła next_event() z input_event_callback.
// Wszystkie czasy w ms (monotonic) podaje wołający, więc testy działają na sztucznych klatkach.
#include <atomic>
#include <cstdint>
#include <vector>

#include "spsc.h"

namespace yoga {

enum class InputOp : uint8_t { Press = 0, Down = 1, Up = 2, ReleaseAll = 3 };

struct InputCmd {
    uint32_t seq = 0;
    uint32_t inputIndex = 0;
    InputOp op = InputOp::Press;
    uint64_t tsMs = 0;  // kiedy wątek IO przyjął komendę; zbyt stare komendy są odrzucane
};

struct InputAck {
    uint32_t seq = 0;
    uint64_t frame = 0;
    bool ok = false;
};

using AckQueue = SpscQueue<InputAck, 512>;

struct InputTuning {
    uint32_t pressFrames = 3;
    uint32_t watchdogMs = 3000;
    uint32_t holdMaxMs = 10000;
    uint32_t staleCmdMs = 1500;
    /// true = powtarzaj wartość każdej klatki (tryb diagnostyczny, gdyby gra nie trzymała stanu)
    bool repeatEachFrame = false;
};

class InputDevice {
public:
    static constexpr uint32_t kMaxInputs = 400;  // SCS_INPUT_MAX_INPUT_COUNT
    static constexpr uint32_t kMaxPending = 4;   // zakolejkowane press na jedno wejście

    InputDevice(uint32_t inputCount, AckQueue* acks, const std::atomic<uint64_t>* lastHbMs, InputTuning tuning = {});

    // ── wątek IO ──
    /// false = kolejka pełna (wołający odpowiada ack ok:false).
    bool submit(const InputCmd& cmd) { return cmds_.push(cmd); }

    // ── wątek gry ──
    void set_active(bool a) { active_.store(a, std::memory_order_release); }
    bool active() const { return active_.load(std::memory_order_acquire); }

    /// Wołane z input_event_callback. Zwraca true i wypełnia (index, value), dopóki są zdarzenia na tę klatkę.
    bool next_event(bool firstInFrame, bool firstAfterActivation, uint64_t nowMs, uint64_t frame, uint32_t& index,
                    bool& value);

    /// Czy w ostatniej klatce zadziałał watchdog / limit trzymania (do zalogowania przez wołającego). Zeruje flagę.
    uint32_t take_trips() {
        const uint32_t t = trips_;
        trips_ = 0;
        return t;
    }

    uint32_t input_count() const { return count_; }

    // Podgląd stanu — testy.
    bool value_sent(uint32_t i) const { return st_[i].sent; }
    bool any_held() const;

private:
    struct State {
        bool held = false;
        bool sent = false;          // ostatnia wartość wydana grze
        bool gap = false;           // następna klatka musi dać false (odstęp między press)
        uint8_t pressLeft = 0;      // klatki true, które zostały do wydania
        uint8_t pending = 0;        // press-y w kolejce
        uint32_t pendingSeq[kMaxPending]{};
        uint64_t heldSince = 0;
    };

    void begin_frame(bool afterActivation, uint64_t nowMs, uint64_t frame);
    void ack(uint32_t seq, uint64_t frame, bool ok) { acks_->push(InputAck{seq, frame, ok}); }
    void release_all(uint64_t frame);
    void apply(const InputCmd& c, uint64_t nowMs, uint64_t frame);

    uint32_t count_;
    AckQueue* acks_;
    const std::atomic<uint64_t>* lastHb_;
    InputTuning tune_;
    SpscQueue<InputCmd, 256> cmds_;
    std::atomic<bool> active_{false};

    std::vector<State> st_;
    std::vector<uint32_t> outIdx_;
    std::vector<uint8_t> outVal_;
    uint32_t outPos_ = 0, outCount_ = 0;
    uint32_t trips_ = 0;
};

}  // namespace yoga
