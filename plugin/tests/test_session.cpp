#include <doctest.h>

#include <string>
#include <vector>

#include "core.h"
#include "framing.h"
#include "session.h"
#include "test_util.h"

using namespace yoga;
using namespace testutil;

namespace {
struct Harness {
    Core core;
    std::string wire;                 // wszystko, co plugin wysłał
    std::vector<std::string> fileLog;  // log do pliku
    IpcSession session;
    uint64_t now = 5000;
    int sends = 0;

    static CoreConfig make_cfg(bool locked = false) {
        CoreConfig c;
        c.semantical = {"light", "horn", "flasher4way"};
        c.inputLocked = locked;
        return c;
    }
    static HelloInfo make_hello() {
        HelloInfo h;
        h.pluginVersion = "test";
        h.gameId = "eut2";
        h.gameName = "ETS2";
        h.gameVersion = "1.62";
        h.apiTelemetry = "1.21";
        h.apiInput = "1.00";
        h.channels = {"truck.speed", "truck.light.beam.low"};
        h.semantical = {"light", "horn", "flasher4way"};
        return h;
    }

    explicit Harness(bool locked = false)
        : core(make_cfg(locked)),
          session(
              core, make_hello(),
              [this](const std::string& b) {
                  wire += b;
                  ++sends;
                  return true;
              },
              [this](std::string_view lvl, std::string_view msg) { fileLog.push_back(std::string(lvl) + ": " + std::string(msg)); }) {
        core.add_slot("truck.speed", SCS_VALUE_TYPE_float);
        core.add_slot("truck.light.beam.low", SCS_VALUE_TYPE_bool);
        core.add_slot("truck.world.placement", SCS_VALUE_TYPE_dplacement);
    }

    // ── symulacja gry ──
    uint64_t gframe = 0;
    void game_frame(float speed, bool beam) {
        const scs_value_t s = vfloat(speed);
        const scs_value_t b = vbool(beam);
        core.on_frame_start(0, static_cast<int64_t>(gframe) * 16000, static_cast<int64_t>(gframe) * 16000);
        core.on_channel(0, &s);
        core.on_channel(1, &b);
        core.on_frame_end();
        ++gframe;
    }
    /// Jedna klatka inputu: wywołuje callback aż do not_found; zwraca wydane (index,value).
    std::vector<std::pair<uint32_t, bool>> input_frame(bool afterActivation = false) {
        std::vector<std::pair<uint32_t, bool>> out;
        uint32_t idx;
        bool val;
        bool first = true;
        while (core.on_input_event(false, first, first && afterActivation, now, idx, val)) {
            out.emplace_back(idx, val);
            first = false;
        }
        return out;
    }

    std::vector<JsonValue> frames() {
        FrameDecoder d(1 << 20);
        d.feed(wire.data(), wire.size());
        std::vector<JsonValue> v;
        std::string p;
        while (d.next(p) == FrameDecoder::Result::Frame) v.push_back(parse(p));
        wire.clear();
        return v;
    }
    static std::vector<const JsonValue*> of_type(const std::vector<JsonValue>& fs, const char* t) {
        std::vector<const JsonValue*> r;
        for (auto& f : fs)
            if (const auto* x = f.find("t"); x && x->str == t) r.push_back(&f);
        return r;
    }
    void send(const std::string& json) { session.on_payload(json, now); }
};

void push_cfg(Core& core, const char* id, const char* brand) {
    scs_named_value_t a[2]{};
    a[0].name = "brand";
    a[0].index = SCS_U32_NIL;
    a[0].value = vstr(brand);
    core.on_config(id, a);
}
}  // namespace

TEST_CASE("połączenie: hello → cfg → tel (pełny), w tej kolejności") {
    Harness h;
    push_cfg(h.core, "truck", "Scania");
    h.game_frame(20.0f, true);
    h.session.pump(h.now);  // bez klienta: nic nie wysyła, cfg zapamiętane
    CHECK(h.sends == 0);

    h.session.on_connect(h.now);
    const auto fs = h.frames();
    REQUIRE(fs.size() == 3);
    CHECK(fs[0].find("t")->str == "hello");
    CHECK(fs[0].find("inputs")->find("semantical")->arr.size() == 3);
    CHECK(fs[1].find("t")->str == "cfg");
    CHECK(fs[1].find("id")->str == "truck");
    CHECK(fs[1].find("attrs")->find("brand")->str == "Scania");
    CHECK(fs[2].find("t")->str == "tel");
    CHECK(fs[2].find("ch")->find("truck.speed")->num == 20.0);
    CHECK(fs[2].find("ch")->find("truck.light.beam.low")->b == true);
    CHECK(fs[2].find("ch")->find("truck.world.placement") == nullptr);  // slot bez wartości
    CHECK(fs[2].find("paused")->b == true);                               // domyślnie pauza do eventu started
}

TEST_CASE("telemetria: potem tylko zmiany; klatki zlane do jednej ramki") {
    Harness h;
    h.game_frame(20.0f, false);
    h.session.on_connect(h.now);
    h.frames();

    h.session.pump(h.now);  // nic nowego
    CHECK(h.frames().empty());

    h.game_frame(21.0f, false);
    h.game_frame(22.0f, false);
    h.game_frame(23.0f, true);  // 3 klatki, jeden pump
    h.session.pump(h.now);
    const auto fs = h.frames();
    REQUIRE(fs.size() == 1);
    CHECK(fs[0].find("frame")->num == 4);
    const auto* ch = fs[0].find("ch");
    CHECK(ch->obj.size() == 2);
    CHECK(ch->find("truck.speed")->num == 23.0);
    CHECK(ch->find("truck.light.beam.low")->b == true);

    h.game_frame(23.0f, true);  // identyczne wartości → brak ramki
    h.session.pump(h.now);
    CHECK(h.frames().empty());
}

TEST_CASE("paused/started: zmiana flagi wysyłana mimo braku zmian w kanałach") {
    Harness h;
    h.game_frame(0, false);
    h.session.on_connect(h.now);
    h.frames();
    h.core.on_paused(false);
    h.game_frame(0, false);
    h.session.pump(h.now);
    const auto fs = h.frames();
    REQUIRE(fs.size() == 1);
    CHECK(fs[0].find("paused")->b == false);
}

TEST_CASE("throttling telMinIntervalMs: najnowszy stan, nie częściej niż co N ms") {
    Harness h;
    h.core.telMinIntervalMs = 8;
    h.game_frame(1.0f, false);
    h.session.on_connect(h.now);
    h.frames();

    h.now += 2;
    h.game_frame(2.0f, false);
    h.session.pump(h.now);
    CHECK(h.frames().empty());  // za wcześnie
    CHECK(h.session.wait_ms(h.now) <= 8);
    CHECK(h.session.wait_ms(h.now) >= 1);

    h.now += 3;
    h.game_frame(3.0f, false);
    h.session.pump(h.now);
    CHECK(h.frames().empty());

    h.now += 4;  // 9 ms od ostatniej ramki
    h.session.pump(h.now);
    const auto fs = h.frames();
    REQUIRE(fs.size() == 1);
    CHECK(fs[0].find("ch")->find("truck.speed")->num == 3.0);
}

TEST_CASE("input: press → ack po wydaniu wartości przez grę") {
    Harness h;
    h.session.on_connect(h.now);
    h.frames();
    h.send(R"({"t":"in","seq":77,"device":"semantical","input":"horn","op":"press"})");
    CHECK(h.frames().empty());  // ack dopiero po klatce gry

    h.game_frame(0, false);
    const auto out = h.input_frame();
    REQUIRE(out.size() == 1);
    CHECK(out[0] == std::make_pair(1u, true));  // "horn" = indeks 1
    h.session.pump(h.now);
    const auto acks = Harness::of_type(h.frames(), "in.ack");
    REQUIRE(acks.size() == 1);
    CHECK(acks[0]->find("seq")->num == 77);
    CHECK(acks[0]->find("ok")->b == true);
    CHECK(acks[0]->find("frame")->num == 1);
}

TEST_CASE("input: nieznane wejście / zły device / axis / wyłączony input → ack ok:false od razu") {
    Harness h;
    h.session.on_connect(h.now);
    h.frames();
    h.send(R"({"t":"in","seq":1,"device":"semantical","input":"nie_ma","op":"press"})");
    h.send(R"({"t":"in","seq":2,"device":"generic","input":"x","op":"press"})");
    h.send(R"({"t":"in","seq":3,"device":"semantical","input":"light","op":"axis","value":0.5})");
    h.send(R"({"t":"opts","inputEnabled":false})");
    h.send(R"({"t":"in","seq":4,"device":"semantical","input":"light","op":"press"})");
    h.session.pump(h.now);
    const auto fs = h.frames();
    const auto acks = Harness::of_type(fs, "in.ack");
    REQUIRE(acks.size() == 4);
    for (auto* a : acks) CHECK(a->find("ok")->b == false);
    // hello po zmianie inputEnabled
    const auto hellos = Harness::of_type(fs, "hello");
    REQUIRE(hellos.size() == 1);
    CHECK(hellos[0]->find("inputEnabled")->b == false);
    // nic nie dotarło do gry
    h.game_frame(0, false);
    CHECK(h.input_frame().empty());
}

TEST_CASE("opts inputEnabled:false zwalnia trzymane wejścia") {
    Harness h;
    h.session.on_connect(h.now);
    h.send(R"({"t":"in","seq":1,"device":"semantical","input":"horn","op":"down"})");
    h.game_frame(0, false);
    REQUIRE(h.input_frame().size() == 1);
    h.send(R"({"t":"opts","inputEnabled":false})");
    h.game_frame(0, false);
    const auto out = h.input_frame();
    REQUIRE(out.size() == 1);
    CHECK(out[0] == std::make_pair(1u, false));
}

TEST_CASE("blokada inputu z konfiguracji (TruckersMP): opts jej nie zdejmie") {
    Harness h(true);
    h.session.on_connect(h.now);
    h.frames();
    h.send(R"({"t":"opts","inputEnabled":true})");
    h.send(R"({"t":"in","seq":1,"device":"semantical","input":"light","op":"press"})");
    h.session.pump(h.now);
    const auto acks = Harness::of_type(h.frames(), "in.ack");
    REQUIRE(acks.size() == 1);
    CHECK(acks[0]->find("ok")->b == false);
}

TEST_CASE("rozłączenie klienta zwalnia trzymane wejścia (bez czekania na watchdog)") {
    Harness h;
    h.session.on_connect(h.now);
    h.send(R"({"t":"in","seq":1,"device":"semantical","input":"horn","op":"down"})");
    h.game_frame(0, false);
    REQUIRE(h.input_frame().size() == 1);
    h.now += 100;
    h.session.on_disconnect(h.now);
    h.game_frame(0, false);
    const auto out = h.input_frame();
    REQUIRE(out.size() == 1);
    CHECK(out[0] == std::make_pair(1u, false));
}

TEST_CASE("watchdog end-to-end: hb od bridge'a podtrzymuje, brak hb zwalnia po 3 s") {
    Harness h;
    h.session.on_connect(h.now);
    h.send(R"({"t":"in","seq":1,"device":"semantical","input":"horn","op":"down"})");
    h.game_frame(0, false);
    REQUIRE(h.input_frame().size() == 1);
    for (int i = 0; i < 8; ++i) {
        h.now += 250;
        h.send(R"({"t":"hb"})");
        h.game_frame(0, false);
        CHECK(h.input_frame().empty());
    }
    h.now += 3100;  // cisza
    h.game_frame(0, false);
    const auto out = h.input_frame();
    REQUIRE(out.size() == 1);
    CHECK(out[0].second == false);
    h.session.pump(h.now);
    const auto logs = Harness::of_type(h.frames(), "log");
    REQUIRE(logs.size() == 1);
    CHECK(logs[0]->find("level")->str == "warn");
}

TEST_CASE("evt, input.active, log z gry są przekazywane; log trafia też do pliku") {
    Harness h;
    h.session.on_connect(h.now);
    h.frames();

    scs_named_value_t a[2]{};
    a[0].name = "revenue";
    a[0].index = SCS_U32_NIL;
    a[0].value.type = SCS_VALUE_TYPE_u64;
    a[0].value.value_u64.value = 777;
    h.core.on_gameplay("job.delivered", a);
    h.core.on_input_active(false, true);
    h.core.game_log("info", "witaj %d", 5);
    h.session.pump(h.now);

    const auto fs = h.frames();
    const auto evts = Harness::of_type(fs, "evt");
    REQUIRE(evts.size() == 1);
    CHECK(evts[0]->find("id")->str == "job.delivered");
    CHECK(evts[0]->find("attrs")->find("revenue")->num == 777);
    const auto act = Harness::of_type(fs, "input.active");
    REQUIRE(act.size() == 1);
    CHECK(act[0]->find("device")->str == "semantical");
    CHECK(act[0]->find("active")->b == true);
    const auto logs = Harness::of_type(fs, "log");
    REQUIRE(logs.size() == 1);
    CHECK(logs[0]->find("msg")->str == "witaj 5");
    REQUIRE(h.fileLog.size() == 1);
    CHECK(h.fileLog[0] == "info: witaj 5");
}

TEST_CASE("ponowne połączenie: ostatnie cfg i stan input.active wysyłane od nowa; pusta cfg kasuje") {
    Harness h;
    push_cfg(h.core, "job", "x");
    push_cfg(h.core, "trailer.0", "y");
    h.core.on_input_active(false, true);
    h.game_frame(1, false);
    h.session.pump(h.now);
    h.session.on_connect(h.now);
    auto fs = h.frames();
    CHECK(Harness::of_type(fs, "cfg").size() == 2);
    CHECK(Harness::of_type(fs, "input.active").size() == 1);

    h.session.on_disconnect(h.now);
    scs_named_value_t none[1]{};  // sama końcówka (name == nullptr) = konfiguracja pusta
    h.core.on_config("job", none);  // zlecenie usunięte
    h.session.pump(h.now);
    h.session.on_connect(h.now);
    fs = h.frames();
    const auto cfgs = Harness::of_type(fs, "cfg");
    REQUIRE(cfgs.size() == 1);
    CHECK(cfgs[0]->find("id")->str == "trailer.0");
}

TEST_CASE("brak klienta: telemetria niczego nie buforuje, ack-i są wyrzucane") {
    Harness h;
    for (int i = 0; i < 1000; ++i) h.game_frame(static_cast<float>(i), false);
    h.session.pump(h.now);
    CHECK(h.sends == 0);
    CHECK(h.core.latest().frame == 1000);  // tylko najnowszy snapshot
}

TEST_CASE("transport zwraca błąd → send_failed") {
    CoreConfig c = Harness::make_cfg();
    Core core(c);
    core.add_slot("truck.speed", SCS_VALUE_TYPE_float);
    IpcSession s(
        core, Harness::make_hello(), [](const std::string&) { return false; }, [](std::string_view, std::string_view) {});
    s.on_connect(1);
    CHECK(s.send_failed());
}
