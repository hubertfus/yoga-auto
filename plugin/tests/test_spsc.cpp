#include <doctest.h>

#include <cstdint>
#include <cstring>
#include <thread>
#include <vector>

#include "spsc.h"

using namespace yoga;

TEST_CASE("SpscQueue: FIFO, pełna kolejka odrzuca") {
    SpscQueue<int, 4> q;
    for (int i = 0; i < 4; ++i) CHECK(q.push(i));
    CHECK_FALSE(q.push(99));
    int v = -1;
    for (int i = 0; i < 4; ++i) {
        REQUIRE(q.pop(v));
        CHECK(v == i);
    }
    CHECK_FALSE(q.pop(v));
    CHECK(q.empty());
}

TEST_CASE("SpscQueue: dwa wątki, kolejność zachowana") {
    SpscQueue<uint32_t, 64> q;
    constexpr uint32_t kN = 200000;
    std::thread prod([&] {
        for (uint32_t i = 0; i < kN;) {
            if (q.push(i)) ++i;
        }
    });
    uint32_t expect = 0;
    while (expect < kN) {
        uint32_t v;
        if (q.pop(v)) {
            REQUIRE(v == expect);
            ++expect;
        }
    }
    prod.join();
}

TEST_CASE("SpscByteRing: rekordy zmiennej długości, zawijanie, brak miejsca") {
    SpscByteRing<64> r;
    CHECK(r.peek_len() == -1);
    std::vector<uint8_t> out;
    // 10 rund po 20+4 bajty → wielokrotne zawijanie
    for (int round = 0; round < 10; ++round) {
        uint8_t rec[20];
        std::memset(rec, round + 1, sizeof rec);
        REQUIRE(r.begin(sizeof rec));
        r.write(rec, 7);  // zapis w kawałkach
        r.write(rec + 7, 13);
        r.commit();
        REQUIRE(r.peek_len() == 20);
        out.resize(20);
        r.pop(out.data());
        for (uint8_t b : out) CHECK(b == round + 1);
    }
    // za duży rekord
    CHECK_FALSE(r.begin(61));
    // zapełnienie: 2 × (20+4) = 48, trzeci 24 nie mieści się w 64
    uint8_t rec[20] = {};
    REQUIRE(r.begin(20));
    r.write(rec, 20);
    r.commit();
    REQUIRE(r.begin(20));
    r.write(rec, 20);
    r.commit();
    CHECK_FALSE(r.begin(20));
}

TEST_CASE("SpscByteRing: niezatwierdzony rekord jest niewidoczny") {
    SpscByteRing<64> r;
    REQUIRE(r.begin(4));
    const uint32_t x = 7;
    r.write(&x, 4);
    CHECK(r.peek_len() == -1);
    r.commit();
    CHECK(r.peek_len() == 4);
}

TEST_CASE("TripleBuffer: czytelnik dostaje najnowszy, stare przepadają") {
    TripleBuffer<int> t;
    t.reset();
    CHECK_FALSE(t.update());
    t.back() = 1;
    t.publish();
    t.back() = 2;
    t.publish();
    t.back() = 3;
    t.publish();
    REQUIRE(t.update());
    CHECK(t.front() == 3);
    CHECK_FALSE(t.update());
    t.back() = 4;
    t.publish();
    REQUIRE(t.update());
    CHECK(t.front() == 4);
}

TEST_CASE("TripleBuffer: dwa wątki, wartości nigdy się nie cofają ani nie rwą") {
    struct Pair {
        uint64_t a, b;
    };
    TripleBuffer<Pair> t;
    t.reset();
    std::atomic<bool> stop{false};
    std::thread w([&] {
        for (uint64_t i = 1; i <= 300000; ++i) {
            t.back() = Pair{i, i * 2};
            t.publish();
        }
        stop = true;
    });
    uint64_t last = 0;
    while (!stop.load() || t.update()) {
        if (t.update()) {
            REQUIRE(t.front().b == t.front().a * 2);  // brak „rozerwanego” odczytu
            REQUIRE(t.front().a > last);
            last = t.front().a;
        }
    }
    w.join();
}
