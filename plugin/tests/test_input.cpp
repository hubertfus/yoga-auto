#include <doctest.h>

#include <atomic>
#include <string>
#include <utility>
#include <vector>

#include "input_device.h"

using namespace yoga;

namespace {
using Out = std::vector<std::pair<uint32_t, bool>>;

// Symulator klatek gry: każda klatka = seria wywołań input_event_callback do not_found.
struct Rig {
    AckQueue acks;
    std::atomic<uint64_t> hb{0};
    InputDevice dev;
    uint64_t now = 1000;
    uint64_t frame = 0;
    bool afterActivation = false;

    explicit Rig(InputTuning t = {}) : dev(5, &acks, &hb, t) { hb = now; }

    Out step(uint64_t dtMs = 16) {
        now += dtMs;
        ++frame;
        Out out;
        uint32_t idx;
        bool val;
        bool first = true;
        while (dev.next_event(first, first && afterActivation, now, frame, idx, val)) {
            out.emplace_back(idx, val);
            first = false;
        }
        afterActivation = false;
        return out;
    }

    void cmd(uint32_t seq, uint32_t input, InputOp op) {
        InputCmd c;
        c.seq = seq;
        c.inputIndex = input;
        c.op = op;
        c.tsMs = now;
        REQUIRE(dev.submit(c));
    }

    std::vector<InputAck> drain_acks() {
        std::vector<InputAck> v;
        InputAck a;
        while (acks.pop(a)) v.push_back(a);
        return v;
    }

    /// Wartość wejścia `i` w kolejnych klatkach ('T'/'F'), '.' = brak zdarzenia (wartość bez zmiany).
    std::string trace(uint32_t i, int frames) {
        std::string s;
        bool cur = false;
        for (int k = 0; k < frames; ++k) {
            for (auto [idx, v] : step())
                if (idx == i) cur = v;
            s.push_back(cur ? 'T' : 'F');
        }
        return s;
    }
};
}  // namespace

TEST_CASE("press: true przez PRESS_FRAMES (3) klatek, potem false; ack przy starcie") {
    Rig r;
    r.cmd(10, 2, InputOp::Press);
    auto o = r.step();
    REQUIRE(o.size() == 1);
    CHECK(o[0] == std::make_pair(2u, true));
    auto acks = r.drain_acks();
    REQUIRE(acks.size() == 1);
    CHECK(acks[0].seq == 10);
    CHECK(acks[0].ok);
    CHECK(acks[0].frame == 1);

    CHECK(r.step().empty());  // klatka 2: nadal true, bez ponownego zdarzenia
    CHECK(r.step().empty());  // klatka 3: ostatnia true
    o = r.step();             // klatka 4: false
    REQUIRE(o.size() == 1);
    CHECK(o[0] == std::make_pair(2u, false));
    CHECK(r.step().empty());
}

TEST_CASE("press: sekwencja klatek T T T F") {
    Rig r;
    r.cmd(1, 0, InputOp::Press);
    CHECK(r.trace(0, 6) == "TTTFFF");
}

TEST_CASE("dwa press tego samego wejścia: co najmniej 1 klatka false pomiędzy") {
    Rig r;
    r.cmd(1, 0, InputOp::Press);
    r.cmd(2, 0, InputOp::Press);
    CHECK(r.trace(0, 10) == "TTTFTTTFFF");
    const auto acks = r.drain_acks();
    REQUIRE(acks.size() == 2);
    CHECK(acks[0].seq == 1);
    CHECK(acks[1].seq == 2);
    CHECK(acks[1].frame == 5);  // drugi impuls startuje w klatce 5
}

TEST_CASE("press przy pressFrames=1: T F T F (odstęp zachowany)") {
    InputTuning t;
    t.pressFrames = 1;
    Rig r(t);
    r.cmd(1, 0, InputOp::Press);
    r.cmd(2, 0, InputOp::Press);
    CHECK(r.trace(0, 6) == "TFTFFF");
}

TEST_CASE("press różnych wejść idzie równolegle") {
    Rig r;
    r.cmd(1, 0, InputOp::Press);
    r.cmd(2, 3, InputOp::Press);
    auto o = r.step();
    CHECK(o.size() == 2);
}

TEST_CASE("press: przepełnienie kolejki wejścia → ack ok:false dla nadmiarowych") {
    Rig r;
    for (uint32_t s = 1; s <= 6; ++s) r.cmd(s, 1, InputOp::Press);
    r.step();
    const auto acks = r.drain_acks();
    int ok = 0, bad = 0;
    for (auto& a : acks) (a.ok ? ok : bad)++;
    CHECK(ok == 1);   // jeden wystartował od razu
    CHECK(bad == 2);  // 4 zmieściło się w kolejce (1 poszedł od razu, 3 czeka), 2 odrzucone
}

TEST_CASE("down/up: wartość trzymana bez powtarzania, up zwalnia; ack od razu") {
    Rig r;
    r.cmd(5, 4, InputOp::Down);
    auto o = r.step();
    REQUIRE(o.size() == 1);
    CHECK(o[0] == std::make_pair(4u, true));
    for (int i = 0; i < 10; ++i) CHECK(r.step().empty());
    r.cmd(6, 4, InputOp::Up);
    o = r.step();
    REQUIRE(o.size() == 1);
    CHECK(o[0] == std::make_pair(4u, false));
    const auto acks = r.drain_acks();
    REQUIRE(acks.size() == 2);
    CHECK(acks[0].ok);
    CHECK(acks[1].ok);
}

TEST_CASE("watchdog: brak hb > 3000 ms zwalnia trzymane wejście") {
    Rig r;
    r.cmd(1, 2, InputOp::Down);
    r.step();
    CHECK(r.dev.any_held());
    // hb odświeżany → trzyma
    for (int i = 0; i < 10; ++i) {
        r.hb = r.now;
        CHECK(r.step(500).empty());  // 5 s symulowanych, ale hb świeży
    }
    CHECK(r.dev.any_held());
    // hb milknie (ostatnie odświeżenie = teraz)
    r.hb = r.now;
    r.step(2900);
    CHECK(r.dev.any_held());
    CHECK(r.dev.take_trips() == 0);
    const auto o = r.step(200);  // > 3000 ms od ostatniego hb
    REQUIRE(o.size() == 1);
    CHECK(o[0] == std::make_pair(2u, false));
    CHECK_FALSE(r.dev.any_held());
    CHECK(r.dev.take_trips() == 1);
    CHECK(r.dev.take_trips() == 0);
}

TEST_CASE("limit trzymania HOLD_MAX_MS (10 s) nawet przy żywym hb") {
    Rig r;
    r.cmd(1, 2, InputOp::Down);
    r.step();
    for (int i = 0; i < 9; ++i) {
        r.hb = r.now;
        r.step(1000);
    }
    CHECK(r.dev.any_held());
    r.hb = r.now;
    const auto o = r.step(1500);  // 10.5 s od down
    REQUIRE(o.size() == 1);
    CHECK(o[0].second == false);
    CHECK(r.dev.take_trips() == 1);
}

TEST_CASE("releaseAll: zwalnia trzymane, kasuje zakolejkowane press-y z ack ok:false") {
    Rig r;
    r.cmd(1, 0, InputOp::Down);
    r.cmd(2, 1, InputOp::Press);
    r.cmd(3, 1, InputOp::Press);
    r.step();
    r.drain_acks();
    r.cmd(0, 0, InputOp::ReleaseAll);
    const auto o = r.step();
    bool zeroFalse = false, oneFalse = false;
    for (auto [i, v] : o) {
        if (i == 0 && !v) zeroFalse = true;
        if (i == 1 && !v) oneFalse = true;
    }
    CHECK(zeroFalse);
    CHECK(oneFalse);
    CHECK_FALSE(r.dev.any_held());
    const auto acks = r.drain_acks();
    REQUIRE(acks.size() == 1);  // drugi press (seq 3) przepadł
    CHECK(acks[0].seq == 3);
    CHECK_FALSE(acks[0].ok);
    CHECK(r.trace(1, 4) == "FFFF");
}

TEST_CASE("nieznane wejście → ack ok:false, brak zdarzenia") {
    Rig r;
    r.cmd(9, 99, InputOp::Press);
    CHECK(r.step().empty());
    const auto acks = r.drain_acks();
    REQUIRE(acks.size() == 1);
    CHECK_FALSE(acks[0].ok);
}

TEST_CASE("komenda przeleżała (urządzenie nieaktywne) → odrzucona") {
    Rig r;
    InputCmd c;
    c.seq = 4;
    c.inputIndex = 0;
    c.op = InputOp::Press;
    c.tsMs = r.now - 5000;
    REQUIRE(r.dev.submit(c));
    CHECK(r.step().empty());
    const auto acks = r.drain_acks();
    REQUIRE(acks.size() == 1);
    CHECK_FALSE(acks[0].ok);
}

TEST_CASE("first_after_activation: cache wyzerowany, trzymane wejście wydane ponownie") {
    Rig r;
    r.cmd(1, 3, InputOp::Down);
    r.step();
    CHECK(r.step().empty());
    r.afterActivation = true;
    const auto o = r.step();
    REQUIRE(o.size() == 1);
    CHECK(o[0] == std::make_pair(3u, true));
}

TEST_CASE("kolejne wywołania w tej samej klatce nie przesuwają stanu") {
    Rig r;
    r.cmd(1, 0, InputOp::Press);
    uint32_t idx;
    bool val;
    CHECK(r.dev.next_event(true, false, r.now, 1, idx, val));
    CHECK_FALSE(r.dev.next_event(false, false, r.now, 1, idx, val));
    CHECK_FALSE(r.dev.next_event(false, false, r.now, 1, idx, val));
}

TEST_CASE("tryb repeatEachFrame powtarza wartość true co klatkę") {
    InputTuning t;
    t.repeatEachFrame = true;
    Rig r(t);
    r.cmd(1, 0, InputOp::Down);
    for (int i = 0; i < 4; ++i) {
        r.hb = r.now;
        const auto o = r.step();
        REQUIRE(o.size() == 1);
        CHECK(o[0] == std::make_pair(0u, true));
    }
}

TEST_CASE("down podczas trwającego press nie gubi trzymania po impulsie") {
    Rig r;
    r.cmd(1, 0, InputOp::Press);
    r.cmd(2, 0, InputOp::Down);
    CHECK(r.trace(0, 6) == "TTTTTT");
}
