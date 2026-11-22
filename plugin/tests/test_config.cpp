#include <doctest.h>

#include "config.h"

using namespace yoga;

TEST_CASE("ini: wartości domyślne przy pustym pliku") {
    const auto s = parse_ini("");
    CHECK(s.inputEnabled);
    CHECK(s.telMinIntervalMs == 0);
    CHECK_FALSE(s.inputRepeat);
}

TEST_CASE("ini: klucze, komentarze, białe znaki, wielkość liter") {
    const auto s = parse_ini(
        "; komentarz\r\n"
        "[yoga-auto]\r\n"
        "  InputEnabled = 0   ; TruckersMP\r\n"
        "telMinIntervalMs=8\r\n"
        "# inny komentarz\r\n"
        "inputRepeat=TRUE\r\n"
        "nieznany=1\r\n");
    CHECK_FALSE(s.inputEnabled);
    CHECK(s.telMinIntervalMs == 8);
    CHECK(s.inputRepeat);
}

TEST_CASE("ini: błędne wartości nie psują ustawień; limit 1000 ms") {
    auto s = parse_ini("inputEnabled=maybe\ntelMinIntervalMs=abc\n");
    CHECK(s.inputEnabled);
    CHECK(s.telMinIntervalMs == 0);
    s = parse_ini("telMinIntervalMs=99999");
    CHECK(s.telMinIntervalMs == 1000);
}
