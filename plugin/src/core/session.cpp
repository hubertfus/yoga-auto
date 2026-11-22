#include "session.h"

#include <vector>

#include "framing.h"
#include <cstdio>
#include <cstring>
#include <memory>

#include "actions.gen.h"

namespace yoga {

IpcSession::IpcSession(Core& core, HelloInfo hello, Sender send, LogSink log)
    : core_(core), hello_(std::move(hello)), send_(std::move(send)), log_(std::move(log)), sent_(new Snapshot()) {
    const auto& cfg = core_.config();
    for (uint32_t i = 0; i < cfg.semantical.size(); ++i) semIdx_.emplace(cfg.semantical[i], i);
    for (uint32_t i = 0; i < cfg.generic.size(); ++i) genIdx_.emplace(cfg.generic[i], i);
}

void IpcSession::frame(const std::string& payload) {
    if (!append_frame(out_, payload, gen::kMaxFrameBytes)) log_("warn", "ramka IPC za duża — pominięta");
}

void IpcSession::flush() {
    if (out_.empty()) return;
    if (connected_ && !send_(out_)) failed_ = true;
    out_.clear();
}

void IpcSession::update_hello(const HelloInfo& h) {
    hello_ = h;
    helloDirty_ = true;
}

void IpcSession::send_log(std::string_view level, std::string_view msg) {
    if (!connected_ || level == "debug") return;
    scratch_.clear();
    build_log(scratch_, level, msg);
    frame(scratch_);
    flush();
}

// ───────────────────────── połączenie ─────────────────────────

void IpcSession::on_connect(uint64_t nowMs) {
    failed_ = false;
    out_.clear();
    drain_events();  // zapamiętaj cfg, które przyszły przed połączeniem
    AckQueue& acks = core_.acks();
    InputAck stale;
    while (acks.pop(stale)) {}
    connected_ = true;
    core_.lastHbMs.store(nowMs, std::memory_order_release);

    hello_.inputEnabled = core_.inputEnabled.load(std::memory_order_relaxed);
    scratch_.clear();
    build_hello(scratch_, hello_);
    frame(scratch_);
    helloDirty_ = false;

    for (const auto& [id, rec] : configs_) {
        scratch_.clear();
        build_cfg(scratch_, rec);
        frame(scratch_);
    }
    static const char* kDev[2] = {"semantical", "generic"};
    for (int d = 0; d < 2; ++d) {
        if (activeState_[d] < 0) continue;
        scratch_.clear();
        build_input_active(scratch_, kDev[d], activeState_[d] != 0);
        frame(scratch_);
    }

    // pełny zestaw kanałów w pierwszej ramce
    haveSent_ = false;
    telDirty_ = core_.latest().frame > 0;
    lastTelMs_ = 0;
    pump_tel(nowMs);
    flush();
}

void IpcSession::on_disconnect(uint64_t nowMs) {
    if (!connected_) return;
    connected_ = false;
    out_.clear();
    // Zwolnij wszystko trzymane: nie czekamy na watchdog.
    InputCmd rel;
    rel.op = InputOp::ReleaseAll;
    rel.tsMs = nowMs;
    core_.device(false).submit(rel);
    if (core_.has_generic()) core_.device(true).submit(rel);
}

// ───────────────────────── pompa ─────────────────────────

void IpcSession::drain_events() {
    auto& ring = core_.events();
    std::vector<uint8_t> buf;
    EventRecord rec;
    for (;;) {
        const int64_t len = ring.peek_len();
        if (len < 0) break;
        buf.resize(static_cast<size_t>(len));
        ring.pop(buf.data());
        if (!decode_event(buf.data(), buf.size(), rec)) continue;
        switch (rec.kind) {
            case EventKind::Config:
                if (rec.attrs.empty()) configs_.erase(rec.id);
                else configs_[rec.id] = rec;
                if (connected_) {
                    scratch_.clear();
                    build_cfg(scratch_, rec);
                    frame(scratch_);
                }
                break;
            case EventKind::Gameplay:
                if (connected_) {
                    scratch_.clear();
                    build_evt(scratch_, rec);
                    frame(scratch_);
                }
                break;
            case EventKind::InputActive: {
                const bool generic = rec.id == "generic";
                const bool active = !rec.attrs.empty() && rec.attrs[0].value.v.value_bool.value != 0;
                activeState_[generic ? 1 : 0] = active ? 1 : 0;
                if (connected_) {
                    scratch_.clear();
                    build_input_active(scratch_, rec.id, active);
                    frame(scratch_);
                }
                break;
            }
            case EventKind::Log: {
                const std::string& msg = rec.attrs.empty() ? std::string() : rec.attrs[0].value.s;
                log_(rec.id, msg);  // do pliku
                if (connected_ && rec.id != "debug") {
                    scratch_.clear();
                    build_log(scratch_, rec.id, msg);
                    frame(scratch_);
                }
                break;
            }
        }
    }
    const uint64_t dropped = core_.droppedEvents.exchange(0, std::memory_order_relaxed);
    if (dropped) {
        char m[96];
        snprintf(m, sizeof m, "pierścień zdarzeń pełny — zgubiono %llu zdarzeń", static_cast<unsigned long long>(dropped));
        log_("warn", m);
    }
}

void IpcSession::drain_acks() {
    InputAck a;
    while (core_.acks().pop(a)) {
        if (!connected_) continue;
        scratch_.clear();
        build_ack(scratch_, a.seq, a.frame, a.ok);
        frame(scratch_);
    }
}

void IpcSession::pump_tel(uint64_t nowMs) {
    if (!connected_ || !telDirty_) return;
    const uint32_t minMs = core_.telMinIntervalMs.load(std::memory_order_relaxed);
    if (minMs > 0 && haveSent_ && nowMs - lastTelMs_ < minMs) return;
    scratch_.clear();
    if (build_tel(scratch_, core_.latest(), haveSent_ ? sent_.get() : nullptr, core_.slots())) {
        frame(scratch_);
        lastTelMs_ = nowMs;
    }
    // sent_ = latest (tylko używane sloty)
    const Snapshot& l = core_.latest();
    sent_->frame = l.frame;
    sent_->simTime = l.simTime;
    sent_->renderTime = l.renderTime;
    sent_->paused = l.paused;
    sent_->count = l.count;
    std::memcpy(sent_->values, l.values, sizeof(scs_value_t) * l.count);
    haveSent_ = true;
    telDirty_ = false;
}

void IpcSession::pump(uint64_t nowMs) {
    drain_events();
    drain_acks();
    if (core_.poll_snapshot()) telDirty_ = true;
    if (connected_ && helloDirty_) {
        scratch_.clear();
        hello_.inputEnabled = core_.inputEnabled.load(std::memory_order_relaxed);
        build_hello(scratch_, hello_);
        frame(scratch_);
        helloDirty_ = false;
    }
    pump_tel(nowMs);
    flush();
}

uint32_t IpcSession::wait_ms(uint64_t nowMs) const {
    const uint32_t minMs = core_.telMinIntervalMs.load(std::memory_order_relaxed);
    if (connected_ && telDirty_ && minMs > 0 && haveSent_) {
        const uint64_t due = lastTelMs_ + minMs;
        return nowMs >= due ? 1 : static_cast<uint32_t>(due - nowMs);
    }
    return 50;
}

// ───────────────────────── komendy ─────────────────────────

void IpcSession::on_payload(std::string_view payload, uint64_t nowMs) {
    const Command c = parse_command(payload);
    switch (c.type) {
        case Command::Type::Invalid: log_("warn", "IPC: nieczytelna komenda"); break;
        case Command::Type::Heartbeat: core_.lastHbMs.store(nowMs, std::memory_order_release); break;
        case Command::Type::ReleaseAll: {
            InputCmd rel;
            rel.op = InputOp::ReleaseAll;
            rel.tsMs = nowMs;
            core_.device(false).submit(rel);
            if (core_.has_generic()) core_.device(true).submit(rel);
            break;
        }
        case Command::Type::Opts: {
            if (c.hasInputEnabled) {
                const bool want = c.inputEnabled && !core_.input_locked();
                const bool was = core_.inputEnabled.exchange(want);
                if (was && !want) {  // wyłączenie → natychmiast zwolnij wszystko
                    InputCmd rel;
                    rel.op = InputOp::ReleaseAll;
                    rel.tsMs = nowMs;
                    core_.device(false).submit(rel);
                    if (core_.has_generic()) core_.device(true).submit(rel);
                }
                if (was != want) helloDirty_ = true;
            }
            if (c.hasTelMin) core_.telMinIntervalMs.store(c.telMinIntervalMs, std::memory_order_relaxed);
            break;
        }
        case Command::Type::Input: {
            const uint64_t fr = core_.frame.load(std::memory_order_relaxed);
            auto reject = [&] {
                scratch_.clear();
                build_ack(scratch_, c.seq, fr, false);
                frame(scratch_);
                flush();
            };
            if (!core_.inputEnabled.load(std::memory_order_relaxed) || c.op == Command::Op::Axis) return reject();
            const auto& idx = c.generic ? genIdx_ : semIdx_;
            const auto it = idx.find(c.input);
            if (it == idx.end() || (c.generic && !core_.has_generic())) return reject();
            InputCmd cmd;
            cmd.seq = c.seq;
            cmd.inputIndex = it->second;
            cmd.tsMs = nowMs;
            switch (c.op) {
                case Command::Op::Press: cmd.op = InputOp::Press; break;
                case Command::Op::Down: cmd.op = InputOp::Down; break;
                default: cmd.op = InputOp::Up; break;
            }
            if (!core_.device(c.generic).submit(cmd)) reject();
            break;
        }
    }
    flush();
}

}  // namespace yoga
