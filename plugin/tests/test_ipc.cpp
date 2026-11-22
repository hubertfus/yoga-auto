#include <doctest.h>

#include <cstring>
#include <string>
#include <vector>

#include "events.h"
#include "ipc_msgs.h"
#include "spsc.h"
#include "test_util.h"
#include "value.h"

using namespace yoga;
using namespace testutil;

TEST_CASE("hello zgodne z fixturą shared/protocol") {
    HelloInfo h;
    h.pluginVersion = "0.1.0";
    h.gameId = "eut2";
    h.gameName = "Euro Truck Simulator 2";
    h.gameVersion = "1.62";
    h.apiTelemetry = "1.18";
    h.apiInput = "1.00";
    h.channels = {"truck.speed", "truck.engine.rpm"};
    h.semantical = {"light", "flasher4way"};
    h.inputEnabled = true;
    std::string out;
    build_hello(out, h);
    const auto got = parse(out);
    const auto want = parse(read_fixture("hello.json"));
    REQUIRE(got.is_object());
    REQUIRE(want.is_object());
    CHECK(json_equal(got, want));
}

TEST_CASE("hello: brak input API → null") {
    HelloInfo h;
    std::string out;
    build_hello(out, h);
    const auto v = parse(out);
    REQUIRE(v.find("api"));
    CHECK(v.find("api")->find("input")->is_null());
}

namespace {
struct TelFixture {
    SlotTable slots;
    Snapshot snap;
    TelFixture() {
        const char* names[] = {"truck.speed", "truck.engine.rpm", "truck.light.beam.low", "trailer.0.wear.chassis",
                               "truck.world.placement"};
        for (auto* n : names) {
            slots.names.push_back(n);
            slots.types.push_back(SCS_VALUE_TYPE_float);
        }
        snap.count = 5;
        snap.frame = 88123;
        snap.simTime = 1843000000;
        snap.renderTime = 1843016000;
        snap.paused = 0;
        snap.values[0] = vfloat(23.61f);
        snap.values[1] = vfloat(1180.0f);
        snap.values[2] = vbool(true);
        snap.values[3] = vfloat(0.031f);
        snap.values[4] = vplace(-9123.4, 52.1, 14022.8, 0.25f, 0.0f, 0.0f);
    }
};
}  // namespace

TEST_CASE("tel (pełny) zgodny z fixturą shared/protocol") {
    TelFixture f;
    std::string out;
    REQUIRE(build_tel(out, f.snap, nullptr, f.slots));
    const auto got = parse(out);
    const auto want = parse(read_fixture("tel.json"));
    REQUIRE(got.is_object());
    CHECK(json_equal(got, want, 1e-5));
}

TEST_CASE("tel: tylko zmienione kanały; brak zmian → false") {
    TelFixture f;
    Snapshot prev = f.snap;
    std::string out;
    CHECK_FALSE(build_tel(out, f.snap, &prev, f.slots));
    CHECK(out.empty());

    f.snap.frame++;
    f.snap.values[0] = vfloat(24.0f);
    REQUIRE(build_tel(out, f.snap, &prev, f.slots));
    const auto v = parse(out);
    const auto* ch = v.find("ch");
    REQUIRE(ch);
    CHECK(ch->obj.size() == 1);
    CHECK(ch->find("truck.speed")->num == doctest::Approx(24.0));
}

TEST_CASE("tel: zmiana samego paused wysyła ramkę z pustym ch") {
    TelFixture f;
    Snapshot prev = f.snap;
    f.snap.paused = 1;
    std::string out;
    REQUIRE(build_tel(out, f.snap, &prev, f.slots));
    const auto v = parse(out);
    CHECK(v.find("paused")->b == true);
    CHECK(v.find("ch")->obj.empty());
}

TEST_CASE("tel: sloty bez wartości (type INVALID) są pomijane") {
    TelFixture f;
    f.snap.values[1] = scs_value_t{};
    std::string out;
    REQUIRE(build_tel(out, f.snap, nullptr, f.slots));
    CHECK(parse(out).find("ch")->find("truck.engine.rpm") == nullptr);
}

TEST_CASE("komenda in/press z fixtury") {
    const auto c = parse_command(read_fixture("in-press.json"));
    REQUIRE(c.type == Command::Type::Input);
    CHECK(c.seq == 77);
    CHECK_FALSE(c.generic);
    CHECK(c.input == "light");
    CHECK(c.op == Command::Op::Press);
}

TEST_CASE("parse_command: hb, releaseAll, opts, błędy") {
    CHECK(parse_command(R"({"t":"hb"})").type == Command::Type::Heartbeat);
    CHECK(parse_command(R"({"t":"releaseAll"})").type == Command::Type::ReleaseAll);
    auto o = parse_command(R"({"t":"opts","inputEnabled":false,"telMinIntervalMs":8})");
    REQUIRE(o.type == Command::Type::Opts);
    CHECK(o.hasInputEnabled);
    CHECK_FALSE(o.inputEnabled);
    CHECK(o.hasTelMin);
    CHECK(o.telMinIntervalMs == 8);
    o = parse_command(R"({"t":"opts","telMinIntervalMs":999999})");
    CHECK(o.telMinIntervalMs == 1000);  // obcięte
    CHECK_FALSE(o.hasInputEnabled);

    CHECK(parse_command("nie json").type == Command::Type::Invalid);
    CHECK(parse_command(R"({"t":"in","seq":1,"device":"semantical","input":"light"})").type == Command::Type::Invalid);
    CHECK(parse_command(R"({"t":"in","seq":-1,"device":"semantical","input":"light","op":"press"})").type ==
          Command::Type::Invalid);
    CHECK(parse_command(R"({"t":"in","seq":1,"device":"keyboard","input":"a","op":"press"})").type ==
          Command::Type::Invalid);
    CHECK(parse_command(R"({"t":"zzz"})").type == Command::Type::Invalid);
    const auto d = parse_command(R"({"t":"in","seq":5,"device":"generic","input":"x","op":"down"})");
    CHECK(d.generic);
    CHECK(d.op == Command::Op::Down);
}

TEST_CASE("zdarzenia: kodowanie binarne ↔ dekodowanie, cfg z atrybutami indeksowanymi") {
    SpscByteRing<4096> ring;
    scs_named_value_t attrs[5]{};
    attrs[0].name = "brand";
    attrs[0].index = SCS_U32_NIL;
    attrs[0].value = vstr("Scania");
    attrs[1].name = "fuel.capacity";
    attrs[1].index = SCS_U32_NIL;
    attrs[1].value = vfloat(600.0f);
    attrs[2].name = "forward.ratio";
    attrs[2].index = 0;
    attrs[2].value = vfloat(10.5f);
    attrs[3].name = "forward.ratio";
    attrs[3].index = 2;  // dziura na indeksie 1
    attrs[3].value = vfloat(4.0f);
    attrs[4].name = nullptr;
    REQUIRE(push_event(ring, EventKind::Config, "truck", attrs));

    std::vector<uint8_t> buf(static_cast<size_t>(ring.peek_len()));
    ring.pop(buf.data());
    EventRecord rec;
    REQUIRE(decode_event(buf.data(), buf.size(), rec));
    CHECK(rec.kind == EventKind::Config);
    CHECK(rec.id == "truck");
    REQUIRE(rec.attrs.size() == 4);

    std::string out;
    build_cfg(out, rec);
    const auto v = parse(out);
    CHECK(v.find("t")->str == "cfg");
    CHECK(v.find("id")->str == "truck");
    const auto* a = v.find("attrs");
    REQUIRE(a);
    CHECK(a->find("brand")->str == "Scania");
    CHECK(a->find("fuel.capacity")->num == 600);
    const auto* fr = a->find("forward.ratio");
    REQUIRE(fr);
    REQUIRE(fr->is_array());
    REQUIRE(fr->arr.size() == 3);
    CHECK(fr->arr[0].num == doctest::Approx(10.5));
    CHECK(fr->arr[1].is_null());
    CHECK(fr->arr[2].num == 4);
}

TEST_CASE("cfg: pusta konfiguracja → attrs:null; evt: płaskie attrs") {
    EventRecord rec;
    rec.kind = EventKind::Config;
    rec.id = "job";
    std::string out;
    build_cfg(out, rec);
    CHECK(parse(out).find("attrs")->is_null());

    rec.kind = EventKind::Gameplay;
    rec.id = "job.delivered";
    EventAttr a;
    a.name = "revenue";
    a.value.v.type = SCS_VALUE_TYPE_u64;
    a.value.v.value_u64.value = 12345;
    rec.attrs.push_back(a);
    out.clear();
    build_evt(out, rec);
    const auto v = parse(out);
    CHECK(v.find("t")->str == "evt");
    CHECK(v.find("attrs")->find("revenue")->num == 12345);
}

TEST_CASE("decode_event odrzuca uciętą ramkę") {
    SpscByteRing<1024> ring;
    scs_named_value_t attrs[2]{};
    attrs[0].name = "x";
    attrs[0].index = SCS_U32_NIL;
    attrs[0].value = vfloat(1.0f);
    REQUIRE(push_event(ring, EventKind::Gameplay, "player.fined", attrs));
    std::vector<uint8_t> buf(static_cast<size_t>(ring.peek_len()));
    ring.pop(buf.data());
    EventRecord rec;
    CHECK(decode_event(buf.data(), buf.size(), rec));
    CHECK_FALSE(decode_event(buf.data(), buf.size() - 1, rec));
    CHECK_FALSE(decode_event(buf.data(), 3, rec));
}

TEST_CASE("value_equal / write_value: typy SDK") {
    CHECK(value_equal(vfloat(1.0f), vfloat(1.0f)));
    CHECK_FALSE(value_equal(vfloat(1.0f), vfloat(1.5f)));
    CHECK_FALSE(value_equal(vfloat(1.0f), vs32(1)));
    CHECK(value_equal(vbool(true), vbool(true)));
    CHECK_FALSE(value_equal(vbool(true), vbool(false)));
    CHECK(value_equal(vplace(1, 2, 3, 0.1f, 0, 0), vplace(1, 2, 3, 0.1f, 0, 0)));
    CHECK_FALSE(value_equal(vplace(1, 2, 3, 0.1f, 0, 0), vplace(1, 2, 3.5, 0.1f, 0, 0)));

    std::string s;
    JsonWriter w(s);
    write_value(w, vs32(-3));
    CHECK(s == "-3");
}
