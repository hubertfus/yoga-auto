#include "input_device.h"

namespace yoga {

InputDevice::InputDevice(uint32_t inputCount, AckQueue* acks, const std::atomic<uint64_t>* lastHbMs, InputTuning tuning)
    : count_(inputCount > kMaxInputs ? kMaxInputs : inputCount),
      acks_(acks),
      lastHb_(lastHbMs),
      tune_(tuning),
      st_(count_),
      outIdx_(count_),
      outVal_(count_) {}

bool InputDevice::any_held() const {
    for (const auto& s : st_)
        if (s.held) return true;
    return false;
}

void InputDevice::release_all(uint64_t frame) {
    for (auto& s : st_) {
        s.held = false;
        s.pressLeft = 0;
        s.gap = false;
        // zakolejkowane press-y przepadają: ack ok:false, żeby bridge nie czekał
        for (uint8_t k = 0; k < s.pending; ++k) ack(s.pendingSeq[k], frame, false);
        s.pending = 0;
    }
}

void InputDevice::apply(const InputCmd& c, uint64_t nowMs, uint64_t frame) {
    if (c.op == InputOp::ReleaseAll) {
        release_all(frame);
        return;
    }
    if (c.inputIndex >= count_) {
        ack(c.seq, frame, false);
        return;
    }
    if (nowMs > c.tsMs && nowMs - c.tsMs > tune_.staleCmdMs) {  // komenda przeleżała (urządzenie nieaktywne)
        ack(c.seq, frame, false);
        return;
    }
    State& s = st_[c.inputIndex];
    switch (c.op) {
        case InputOp::Press:
            if (s.pending >= kMaxPending) {
                ack(c.seq, frame, false);
            } else {
                s.pendingSeq[s.pending++] = c.seq;  // ack przy starcie impulsu
            }
            break;
        case InputOp::Down:
            if (!s.held) s.heldSince = nowMs;
            s.held = true;
            ack(c.seq, frame, true);
            break;
        case InputOp::Up:
            s.held = false;
            ack(c.seq, frame, true);
            break;
        default: ack(c.seq, frame, false); break;
    }
}

void InputDevice::begin_frame(bool afterActivation, uint64_t nowMs, uint64_t frame) {
    outPos_ = outCount_ = 0;

    if (afterActivation) {
        // Gra zaczyna od zera: cache = „nic nie wydane”. Trzymane wejścia zostaną wydane ponownie.
        for (auto& s : st_) s.sent = false;
    }

    // 1. komendy z wątku IO
    InputCmd c;
    while (cmds_.pop(c)) apply(c, nowMs, frame);

    // 2. watchdog: brak hb → zwolnij wszystko trzymane
    if (any_held()) {
        const uint64_t hb = lastHb_ ? lastHb_->load(std::memory_order_acquire) : 0;
        bool trip = nowMs > hb && nowMs - hb > tune_.watchdogMs;
        if (!trip) {
            for (const auto& s : st_)
                if (s.held && nowMs > s.heldSince && nowMs - s.heldSince > tune_.holdMaxMs) trip = true;
        }
        if (trip) {
            for (auto& s : st_) s.held = false;
            ++trips_;
        }
    }

    // 3. wartość docelowa na tę klatkę
    for (uint32_t i = 0; i < count_; ++i) {
        State& s = st_[i];
        bool pulse = false;
        if (s.pressLeft > 0) {
            pulse = true;
            if (--s.pressLeft == 0) s.gap = true;
        } else if (s.gap) {
            s.gap = false;  // gwarantowane false między dwoma impulsami
        } else if (s.pending > 0) {
            ack(s.pendingSeq[0], frame, true);
            for (uint8_t k = 1; k < s.pending; ++k) s.pendingSeq[k - 1] = s.pendingSeq[k];
            --s.pending;
            pulse = true;
            const uint32_t frames = tune_.pressFrames ? tune_.pressFrames : 1;
            s.pressLeft = static_cast<uint8_t>(frames - 1);
            if (s.pressLeft == 0) s.gap = true;
        }
        const bool want = pulse || s.held;
        if (want != s.sent || (tune_.repeatEachFrame && want)) {
            s.sent = want;
            outIdx_[outCount_] = i;
            outVal_[outCount_] = want ? 1 : 0;
            ++outCount_;
        }
    }
}

bool InputDevice::next_event(bool firstInFrame, bool firstAfterActivation, uint64_t nowMs, uint64_t frame,
                             uint32_t& index, bool& value) {
    if (firstInFrame) begin_frame(firstAfterActivation, nowMs, frame);
    if (outPos_ >= outCount_) return false;
    index = outIdx_[outPos_];
    value = outVal_[outPos_] != 0;
    ++outPos_;
    return true;
}

}  // namespace yoga
