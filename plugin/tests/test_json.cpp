#include <doctest.h>

#include <string>

#include "framing.h"
#include "json.h"

using namespace yoga;

TEST_CASE("JsonWriter: obiekty, tablice, przecinki") {
    std::string s;
    JsonWriter w(s);
    w.begin_object();
    w.key("a").value(1);
    w.key("b").begin_array().value(true).value("x").null().end_array();
    w.key("c").begin_object().key("d").value(2.5).end_object();
    w.key("e").begin_array().end_array();
    w.end_object();
    CHECK(s == R"({"a":1,"b":[true,"x",null],"c":{"d":2.5},"e":[]})");
}

TEST_CASE("JsonWriter: liczby — float najkrótszy zapis, NaN/Inf → null, -0 → 0") {
    std::string s;
    JsonWriter w(s);
    w.begin_array();
    w.value(23.61f);
    w.value(0.1f);
    w.value(-0.0f);
    w.value(std::numeric_limits<float>::infinity());
    w.value(std::numeric_limits<double>::quiet_NaN());
    w.value(uint64_t{18446744073709551615ull});
    w.value(int64_t{-5});
    w.end_array();
    CHECK(s == "[23.61,0.1,0,null,null,18446744073709551615,-5]");
}

TEST_CASE("JsonWriter: escapowanie i UTF-8") {
    std::string s;
    JsonWriter w(s);
    w.value(std::string_view("a\"b\c\n\t\x01 zażółć"));
    CHECK(s == "\"a\\\"b\\c\n\t\u0001 zażółć\"");
}

TEST_CASE("json_parse: round-trip i błędy") {
    JsonValue v;
    REQUIRE(json_parse(R"({"t":"in","seq":77,"x":[1,2.5,-3e2,true,false,null,"\u0105\n"],"o":{}})", v));
    CHECK(v.find("t")->str == "in");
    CHECK(v.find("seq")->num == 77);
    const auto& x = v.find("x")->arr;
    REQUIRE(x.size() == 7);
    CHECK(x[2].num == -300);
    CHECK(x[6].str == "ą\n");
    CHECK(v.find("o")->is_object());
    CHECK(v.find("zzz") == nullptr);

    CHECK_FALSE(json_parse("", v));
    CHECK_FALSE(json_parse("{", v));
    CHECK_FALSE(json_parse(R"({"a":1,})", v));
    CHECK_FALSE(json_parse(R"({"a":1} x)", v));
    CHECK_FALSE(json_parse(R"("\ud800")", v));  // niesparowany surogat
    CHECK_FALSE(json_parse("[1,2", v));
    CHECK_FALSE(json_parse(std::string(100, '['), v));  // za głęboko
}

TEST_CASE("json_equal: kolejność kluczy bez znaczenia, tolerancja liczb") {
    JsonValue a, b;
    REQUIRE(json_parse(R"({"a":1.0000001,"b":[1,2]})", a));
    REQUIRE(json_parse(R"({"b":[1,2],"a":1})", b));
    CHECK(json_equal(a, b));
    REQUIRE(json_parse(R"({"b":[1,3],"a":1})", b));
    CHECK_FALSE(json_equal(a, b));
}

TEST_CASE("FrameDecoder: ramki uint32 LE, dzielone na kawałki, limit rozmiaru") {
    std::string bytes;
    REQUIRE(append_frame(bytes, R"({"t":"hb"})", 1024));
    REQUIRE(append_frame(bytes, "x", 1024));
    CHECK(static_cast<unsigned char>(bytes[0]) == 11);
    CHECK(bytes[1] == 0);

    FrameDecoder d(1024);
    std::string p;
    // po jednym bajcie
    int frames = 0;
    for (char c : bytes) {
        d.feed(&c, 1);
        while (d.next(p) == FrameDecoder::Result::Frame) {
            ++frames;
            CHECK((p == R"({"t":"hb"})" || p == "x"));
        }
    }
    CHECK(frames == 2);

    std::string big;
    CHECK_FALSE(append_frame(big, std::string(2000, 'a'), 1024));
    const char huge[4] = {0, 0, 4, 0};  // 262144 > 1024
    FrameDecoder d2(1024);
    d2.feed(huge, 4);
    CHECK(d2.next(p) == FrameDecoder::Result::TooLarge);
}
