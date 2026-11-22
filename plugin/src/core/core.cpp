#include "core.h"

#include <cstdarg>
#include <cstdio>

namespace yoga {

Core::Core(CoreConfig cfg)
    : inputEnabled(cfg.inputEnabled && !cfg.inputLocked), telMinIntervalMs(cfg.telMinIntervalMs), cfg_(std::move(cfg)) {
    snap_.reset();
    const auto n = static_cast<uint32_t>(cfg_.semantical.size());
    if (n) semantical_ = std::make_unique<InputDevice>(n, &acks_, &lastHbMs, cfg_.tuning);
    const auto g = static_cast<uint32_t>(cfg_.generic.size());
    if (g) generic_ = std::make_unique<InputDevice>(g, &acks_, &lastHbMs, cfg_.tuning);
    if (!semantical_) semantical_ = std::make_unique<InputDevice>(1, &acks_, &lastHbMs, cfg_.tuning);
}

int Core::add_slot(std::string name, scs_value_type_t type) {
    if (slots_.names.size() >= kMaxSlots) return -1;
    slots_.names.push_back(std::move(name));
    slots_.types.push_back(type);
    work_.count = static_cast<uint32_t>(slots_.names.size());
    return static_cast<int>(slots_.names.size() - 1);
}

// ───────────────────────── wątek gry ─────────────────────────

void Core::on_channel(uint32_t slot, const scs_value_t* v) noexcept {
    if (slot >= work_.count || !v) return;
    work_.values[slot] = *v;
}

void Core::on_frame_start(uint32_t, int64_t renderTimeUs, int64_t simTimeUs) noexcept {
    work_.renderTime = renderTimeUs;
    work_.simTime = simTimeUs;
}

void Core::on_frame_end() noexcept {
    ++work_.frame;
    frame.store(work_.frame, std::memory_order_relaxed);
    Snapshot& b = snap_.back();
    // kopiujemy nagłówek + tylko używane sloty (reszta tablicy się nie zmienia)
    b.frame = work_.frame;
    b.simTime = work_.simTime;
    b.renderTime = work_.renderTime;
    b.paused = work_.paused;
    b.count = work_.count;
    std::memcpy(b.values, work_.values, sizeof(scs_value_t) * work_.count);
    snap_.publish();
    wake();
}

void Core::on_paused(bool paused) noexcept { work_.paused = paused ? 1 : 0; }

void Core::on_config(const char* id, const scs_named_value_t* attrs) noexcept {
    if (!push_event(events_, EventKind::Config, id, attrs)) droppedEvents.fetch_add(1, std::memory_order_relaxed);
    wake();
}

void Core::on_gameplay(const char* id, const scs_named_value_t* attrs) noexcept {
    if (!push_event(events_, EventKind::Gameplay, id, attrs)) droppedEvents.fetch_add(1, std::memory_order_relaxed);
    wake();
}

void Core::game_log(const char* level, const char* fmt, ...) noexcept {
    char msg[256];
    va_list args;
    va_start(args, fmt);
    vsnprintf(msg, sizeof msg, fmt, args);
    va_end(args);
    scs_named_value_t attrs[2]{};
    attrs[0].name = "msg";
    attrs[0].index = SCS_U32_NIL;
    attrs[0].value.type = SCS_VALUE_TYPE_string;
    attrs[0].value.value_string.value = msg;
    if (!push_event(events_, EventKind::Log, level, attrs)) droppedEvents.fetch_add(1, std::memory_order_relaxed);
    wake();
}

void Core::on_input_active(bool generic, bool active) noexcept {
    InputDevice& d = device(generic);
    d.set_active(active);
    if (!push_input_active(events_, generic ? "generic" : "semantical", active))
        droppedEvents.fetch_add(1, std::memory_order_relaxed);
    wake();
}

bool Core::on_input_event(bool generic, bool firstInFrame, bool firstAfterActivation, uint64_t nowMs, uint32_t& index,
                          bool& value) noexcept {
    InputDevice& d = device(generic);
    const bool ok = d.next_event(firstInFrame, firstAfterActivation, nowMs, frame.load(std::memory_order_relaxed), index,
                                 value);
    if (firstInFrame) {
        if (d.take_trips()) game_log("warn", "input: watchdog/limit trzymania — zwolniono wszystkie wejścia");
    }
    return ok;
}

// ───────────────────────── wątek IO ─────────────────────────

bool Core::poll_snapshot() {
    if (!snap_.update()) return false;
    const Snapshot& f = snap_.front();
    latest_.frame = f.frame;
    latest_.simTime = f.simTime;
    latest_.renderTime = f.renderTime;
    latest_.paused = f.paused;
    latest_.count = f.count;
    std::memcpy(latest_.values, f.values, sizeof(scs_value_t) * f.count);
    return true;
}

}  // namespace yoga
