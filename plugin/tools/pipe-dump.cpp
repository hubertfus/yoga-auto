// pipe-dump — łączy się z pipe pluginu, wypisuje ramki IPC i opcjonalnie wysyła komendy.
//
//   pipe-dump                              podgląd (tel ograniczone do 1 / 250 ms)
//   pipe-dump --only hello,cfg,evt,log     filtr typów ramek
//   pipe-dump --all                        wszystkie ramki tel (bez ograniczania)
//   pipe-dump --press light                impuls wejścia semantical
//   pipe-dump --hold horn 1500             down → czekaj 1500 ms → up
//   pipe-dump --down horn / --up horn      ręczne trzymanie
//   pipe-dump --send '{"t":"opts","inputEnabled":false}'
//   pipe-dump --wait 500                   pauza między akcjami
//   pipe-dump --seconds 10                 zakończ po 10 s (bez tego: po akcjach + 1,5 s albo Ctrl+C)
//   pipe-dump --no-hb                      nie wysyłaj heartbeatów (test watchdoga 3 s)
//   pipe-dump --pipe \\.\pipe\inna         inna nazwa pipe
//
// Akcje wykonują się po kolei po odebraniu pierwszej ramki (hello). Plugin obsługuje 1 klienta naraz —
// zamknij bridge przed użyciem.
#include <windows.h>

#include <atomic>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <map>
#include <mutex>
#include <set>
#include <string>
#include <thread>
#include <vector>

#include "actions.gen.h"
#include "framing.h"
#include "json.h"

namespace {

using Clock = std::chrono::steady_clock;

struct Action {
    enum Kind { Send, Wait } kind = Send;
    std::string json;
    int ms = 0;
};

std::atomic<bool> g_stop{false};
BOOL WINAPI on_ctrl(DWORD) {
    g_stop = true;
    return TRUE;
}

HANDLE g_pipe = INVALID_HANDLE_VALUE;
std::mutex g_writeMx;
std::mutex g_printMx;
Clock::time_point g_t0;

double elapsed() { return std::chrono::duration<double>(Clock::now() - g_t0).count(); }

bool write_frame(const std::string& json) {
    std::string bytes;
    yoga::append_frame(bytes, json, yoga::gen::kMaxFrameBytes);
    std::lock_guard lock(g_writeMx);
    HANDLE ev = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    OVERLAPPED ov{};
    ov.hEvent = ev;
    DWORD n = 0;
    bool ok = true;
    if (!WriteFile(g_pipe, bytes.data(), static_cast<DWORD>(bytes.size()), &n, &ov)) {
        if (GetLastError() != ERROR_IO_PENDING || !GetOverlappedResult(g_pipe, &ov, &n, TRUE)) ok = false;
    }
    CloseHandle(ev);
    return ok;
}

std::string press_json(unsigned seq, const std::string& input, const char* op) {
    return std::string(R"({"t":"in","seq":)") + std::to_string(seq) + R"(,"device":"semantical","input":")" + input +
           R"(","op":")" + op + R"("})";
}

void usage() {
    std::fputs(
        "użycie: pipe-dump [--only t1,t2] [--all] [--press X] [--hold X MS] [--down X] [--up X]\n"
        "                  [--send JSON] [--wait MS] [--seconds N] [--no-hb] [--pipe NAZWA]\n",
        stderr);
}

}  // namespace

int main(int argc, char** argv) {
    SetConsoleOutputCP(CP_UTF8);
    SetConsoleCtrlHandler(on_ctrl, TRUE);

    std::wstring pipeName = yoga::gen::kPipeName;
    std::set<std::string> only;
    bool showAllTel = false, sendHb = true;
    int seconds = 0;
    std::vector<Action> actions;
    unsigned seq = 1;

    for (int i = 1; i < argc; ++i) {
        const std::string a = argv[i];
        auto need = [&](int n) {
            if (i + n >= argc) {
                usage();
                std::exit(2);
            }
        };
        if (a == "--only") {
            need(1);
            std::string list = argv[++i];
            size_t p = 0;
            while (p <= list.size()) {
                size_t e = list.find(',', p);
                if (e == std::string::npos) e = list.size();
                only.insert(list.substr(p, e - p));
                p = e + 1;
            }
        } else if (a == "--all") {
            showAllTel = true;
        } else if (a == "--no-hb") {
            sendHb = false;
        } else if (a == "--seconds") {
            need(1);
            seconds = std::atoi(argv[++i]);
        } else if (a == "--pipe") {
            need(1);
            const std::string n = argv[++i];
            pipeName.assign(n.begin(), n.end());
        } else if (a == "--press") {
            need(1);
            actions.push_back({Action::Send, press_json(seq++, argv[++i], "press"), 0});
        } else if (a == "--down") {
            need(1);
            actions.push_back({Action::Send, press_json(seq++, argv[++i], "down"), 0});
        } else if (a == "--up") {
            need(1);
            actions.push_back({Action::Send, press_json(seq++, argv[++i], "up"), 0});
        } else if (a == "--hold") {
            need(2);
            const std::string input = argv[++i];
            const int ms = std::atoi(argv[++i]);
            actions.push_back({Action::Send, press_json(seq++, input, "down"), 0});
            actions.push_back({Action::Wait, "", ms});
            actions.push_back({Action::Send, press_json(seq++, input, "up"), 0});
        } else if (a == "--send") {
            need(1);
            actions.push_back({Action::Send, argv[++i], 0});
        } else if (a == "--wait") {
            need(1);
            actions.push_back({Action::Wait, "", std::atoi(argv[++i])});
        } else {
            usage();
            return 2;
        }
    }

    // ── połączenie (z ponawianiem) ──
    g_t0 = Clock::now();
    std::fwprintf(stderr, L"łączę z %ls …\n", pipeName.c_str());
    while (!g_stop) {
        g_pipe = CreateFileW(pipeName.c_str(), GENERIC_READ | GENERIC_WRITE, 0, nullptr, OPEN_EXISTING, FILE_FLAG_OVERLAPPED,
                             nullptr);
        if (g_pipe != INVALID_HANDLE_VALUE) break;
        const DWORD err = GetLastError();
        if (err == ERROR_PIPE_BUSY) WaitNamedPipeW(pipeName.c_str(), 1000);
        else Sleep(500);
    }
    if (g_pipe == INVALID_HANDLE_VALUE) return 1;
    g_t0 = Clock::now();
    std::fputs("połączono\n", stderr);

    std::atomic<bool> gotFirst{false}, actionsDone{actions.empty()};
    std::atomic<double> actionsDoneAt{0};

    std::thread hb;
    if (sendHb) {
        hb = std::thread([] {
            while (!g_stop) {
                if (!write_frame(R"({"t":"hb"})")) {
                    g_stop = true;
                    break;
                }
                for (int k = 0; k < 25 && !g_stop; ++k) Sleep(10);
            }
        });
    }
    std::thread act([&] {
        while (!gotFirst && !g_stop) Sleep(10);
        for (const auto& a : actions) {
            if (g_stop) break;
            if (a.kind == Action::Wait) {
                for (int t = 0; t < a.ms && !g_stop; t += 10) Sleep(10);
            } else {
                {
                    std::lock_guard lock(g_printMx);
                    std::printf("[+%7.3fs] >> %s\n", elapsed(), a.json.c_str());
                }
                if (!write_frame(a.json)) g_stop = true;
            }
        }
        actionsDoneAt = elapsed();
        actionsDone = true;
    });

    // ── pętla odczytu ──
    HANDLE evR = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    yoga::FrameDecoder decoder(yoga::gen::kMaxFrameBytes);
    std::vector<char> buf(32 * 1024);
    std::map<std::string, unsigned> counts;
    double lastTelPrint = -1;
    unsigned telSuppressed = 0;
    std::string payload;

    OVERLAPPED ov{};
    ov.hEvent = evR;
    bool pending = false;
    while (!g_stop) {
        if (seconds > 0 && elapsed() >= seconds) break;
        if (actionsDone && !actions.empty() && seconds == 0 && elapsed() - actionsDoneAt >= 1.5) break;
        if (!pending) {
            ResetEvent(evR);
            DWORD n = 0;
            if (!ReadFile(g_pipe, buf.data(), static_cast<DWORD>(buf.size()), &n, &ov) && GetLastError() != ERROR_IO_PENDING) {
                std::fputs("pipe zamknięty przez plugin\n", stderr);
                break;
            }
            pending = true;
        }
        if (WaitForSingleObject(evR, 50) != WAIT_OBJECT_0) continue;
        DWORD n = 0;
        pending = false;
        if (!GetOverlappedResult(g_pipe, &ov, &n, FALSE) || n == 0) {
            std::fputs("pipe zamknięty przez plugin\n", stderr);
            break;
        }
        decoder.feed(buf.data(), n);
        yoga::FrameDecoder::Result r;
        while ((r = decoder.next(payload)) == yoga::FrameDecoder::Result::Frame) {
            gotFirst = true;
            yoga::JsonValue v;
            std::string type = "?";
            if (yoga::json_parse(payload, v))
                if (const auto* t = v.find("t"); t && t->is_string()) type = t->str;
            ++counts[type];
            if (!only.empty() && !only.count(type)) continue;
            if (type == "tel" && !showAllTel) {
                if (lastTelPrint >= 0 && elapsed() - lastTelPrint < 0.25) {
                    ++telSuppressed;
                    continue;
                }
                lastTelPrint = elapsed();
            }
            std::lock_guard lock(g_printMx);
            if (telSuppressed && type == "tel") {
                std::printf("          (… pominięto %u ramek tel)\n", telSuppressed);
                telSuppressed = 0;
            }
            std::printf("[+%7.3fs] %s\n", elapsed(), payload.c_str());
            std::fflush(stdout);
        }
        if (r == yoga::FrameDecoder::Result::TooLarge) {
            std::fputs("ramka za duża\n", stderr);
            break;
        }
    }

    g_stop = true;
    if (pending) {
        CancelIoEx(g_pipe, &ov);
        DWORD n;
        GetOverlappedResult(g_pipe, &ov, &n, TRUE);
    }
    if (act.joinable()) act.join();
    if (hb.joinable()) hb.join();
    CloseHandle(g_pipe);

    std::fputs("── podsumowanie ramek ──\n", stderr);
    for (const auto& [t, c] : counts) std::fprintf(stderr, "  %-14s %u\n", t.c_str(), c);
    return 0;
}
