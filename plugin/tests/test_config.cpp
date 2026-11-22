#include <doctest.h>

#include <windows.h>

#include <fstream>
#include <sstream>
#include <string>

#include "config.h"
#include "log.h"

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

TEST_CASE("log: zapis UTF-8 i %ls do pliku nie wywala UCRT") {
    wchar_t tmpDir[MAX_PATH]{};
    REQUIRE(GetTempPathW(MAX_PATH, tmpDir) > 0);
    const std::wstring path = std::wstring(tmpDir) + L"yoga_auto_test_" + std::to_wstring(GetCurrentProcessId()) + L".log";
    DeleteFileW(path.c_str());

    log_open_file(path);
    logf("info", "pipe: nasłuchuję na %ls", L"\\\\.\\pipe\\yoga-auto");
    log_close();

    std::ifstream in(path, std::ios::binary);
    REQUIRE(in.good());
    std::stringstream ss;
    ss << in.rdbuf();
    const std::string content = ss.str();
    in.close();
    DeleteFileW(path.c_str());

    CHECK(content.find("[info] pipe: nasłuchuję na \\\\.\\pipe\\yoga-auto") != std::string::npos);
}
