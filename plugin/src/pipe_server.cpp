#include "pipe_server.h"

#include <windows.h>
#include <sddl.h>

#include <string>
#include <vector>

#include "actions.gen.h"
#include "framing.h"
#include "log.h"
#include "session.h"

namespace yoga {

namespace {
constexpr DWORD kPipeBuf = 64 * 1024;
constexpr DWORD kWriteTimeoutMs = 2000;

uint64_t now_ms() { return GetTickCount64(); }

/// SDDL: pełny dostęp tylko dla użytkownika, który uruchomił grę.
std::wstring current_user_sddl() {
    HANDLE tok = nullptr;
    if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &tok)) return {};
    DWORD need = 0;
    GetTokenInformation(tok, TokenUser, nullptr, 0, &need);
    std::vector<BYTE> buf(need);
    std::wstring sddl;
    if (need && GetTokenInformation(tok, TokenUser, buf.data(), need, &need)) {
        LPWSTR sid = nullptr;
        if (ConvertSidToStringSidW(reinterpret_cast<TOKEN_USER*>(buf.data())->User.Sid, &sid)) {
            sddl = std::wstring(L"D:P(A;;GA;;;") + sid + L")";
            LocalFree(sid);
        }
    }
    CloseHandle(tok);
    return sddl;
}

struct Event {
    HANDLE h;
    explicit Event(bool manual) : h(CreateEventW(nullptr, manual ? TRUE : FALSE, FALSE, nullptr)) {}
    ~Event() {
        if (h) CloseHandle(h);
    }
    Event(const Event&) = delete;
    Event& operator=(const Event&) = delete;
};
}  // namespace

struct PipeServer::Impl {
    Core& core;
    HelloInfo helloInit;

    Event stop{true};
    Event wake{false};
    Event evConn{true};
    Event evRead{true};
    Event evWrite{true};

    std::thread thread;
    std::atomic<bool> running{false};

    std::mutex helloMx;
    HelloInfo helloPending;
    std::atomic<bool> helloDirty{false};

    HANDLE pipe = INVALID_HANDLE_VALUE;
    PSECURITY_DESCRIPTOR sd = nullptr;
    SECURITY_ATTRIBUTES sa{};

    Impl(Core& c, HelloInfo h) : core(c), helloInit(std::move(h)) {}

    ~Impl() {
        if (sd) LocalFree(sd);
    }

    static void wake_cb(void* ctx) { SetEvent(static_cast<Impl*>(ctx)->wake.h); }

    bool create_pipe(bool first) {
        if (!sd) {
            const std::wstring sddl = current_user_sddl();
            if (sddl.empty() ||
                !ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl.c_str(), SDDL_REVISION_1, &sd, nullptr)) {
                logf("error", "pipe: nie udało się zbudować ACL (err %lu) — serwer IPC nie wystartuje", GetLastError());
                return false;
            }
            sa.nLength = sizeof sa;
            sa.lpSecurityDescriptor = sd;
            sa.bInheritHandle = FALSE;
        }
        DWORD flags = PIPE_ACCESS_DUPLEX | FILE_FLAG_OVERLAPPED;
        if (first) flags |= FILE_FLAG_FIRST_PIPE_INSTANCE;  // nikt inny nie podstawi własnego pipe pod tę nazwę
        pipe = CreateNamedPipeW(gen::kPipeName, flags,
                                PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS, 1, kPipeBuf,
                                kPipeBuf, 0, &sa);
        if (pipe == INVALID_HANDLE_VALUE) {
            logf("error", "pipe: CreateNamedPipe nieudane (err %lu)", GetLastError());
            return false;
        }
        return true;
    }

    /// Zapis całej porcji z limitem czasu. false = klient nie czyta / pipe zerwany.
    bool write_all(const std::string& bytes) {
        size_t off = 0;
        while (off < bytes.size()) {
            OVERLAPPED ov{};
            ov.hEvent = evWrite.h;
            ResetEvent(evWrite.h);
            const DWORD chunk = static_cast<DWORD>(std::min<size_t>(bytes.size() - off, kPipeBuf));
            DWORD n = 0;
            if (!WriteFile(pipe, bytes.data() + off, chunk, &n, &ov)) {
                if (GetLastError() != ERROR_IO_PENDING) return false;
                const HANDLE hs[2] = {stop.h, evWrite.h};
                const DWORD w = WaitForMultipleObjects(2, hs, FALSE, kWriteTimeoutMs);
                if (w != WAIT_OBJECT_0 + 1) {
                    CancelIoEx(pipe, &ov);
                    GetOverlappedResult(pipe, &ov, &n, TRUE);
                    return false;
                }
                if (!GetOverlappedResult(pipe, &ov, &n, FALSE)) return false;
            }
            if (n == 0) return false;
            off += n;
        }
        return true;
    }

    void run() {
        bool first = true;
        // Sesja żyje przez cały czas działania pluginu: trzyma ostatnie cfg i stan input.active między klientami.
        IpcSession session(
            core, helloInit, [this](const std::string& b) { return write_all(b); },
            [](std::string_view lvl, std::string_view msg) {
                const std::string l(lvl), m(msg);
                log_file_only(l.c_str(), m.c_str());  // do bridge'a poszło już przez sesję
            });
        while (WaitForSingleObject(stop.h, 0) != WAIT_OBJECT_0) {
            if (pipe == INVALID_HANDLE_VALUE) {
                if (!create_pipe(first)) {
                    if (WaitForSingleObject(stop.h, 1000) == WAIT_OBJECT_0) break;
                    continue;
                }
                first = false;
                logf("info", "pipe: nasłuchuję na %ls", gen::kPipeName);
            }
            serve_one_client_cycle(session);
        }
        if (pipe != INVALID_HANDLE_VALUE) {
            CloseHandle(pipe);
            pipe = INVALID_HANDLE_VALUE;
        }
    }

    HelloInfo take_hello() {
        std::lock_guard lock(helloMx);
        return helloPending;
    }

    void serve_one_client_cycle(IpcSession& session) {
        // ── czekanie na klienta (w tym czasie zbieramy cfg z gry, żeby nic nie zgubić) ──
        OVERLAPPED ovc{};
        ovc.hEvent = evConn.h;
        ResetEvent(evConn.h);
        bool connected = false;
        if (ConnectNamedPipe(pipe, &ovc)) {
            connected = true;
        } else {
            const DWORD err = GetLastError();
            if (err == ERROR_PIPE_CONNECTED) connected = true;
            else if (err != ERROR_IO_PENDING) {
                logf("error", "pipe: ConnectNamedPipe (err %lu)", err);
                CloseHandle(pipe);
                pipe = INVALID_HANDLE_VALUE;
                Sleep(500);
                return;
            }
        }
        while (!connected) {
            const HANDLE hs[3] = {stop.h, evConn.h, wake.h};
            const DWORD w = WaitForMultipleObjects(3, hs, FALSE, 100);
            if (w == WAIT_OBJECT_0) {
                CancelIoEx(pipe, &ovc);
                DWORD n;
                GetOverlappedResult(pipe, &ovc, &n, TRUE);
                return;
            }
            if (w == WAIT_OBJECT_0 + 1) {
                DWORD n;
                connected = GetOverlappedResult(pipe, &ovc, &n, FALSE) != 0;
                if (!connected) {
                    DisconnectNamedPipe(pipe);
                    return;
                }
            } else {
                session.pump(now_ms());  // bez klienta: tylko cfg do pamięci, tel się nie wysyła
            }
        }

        // ── sesja ──
        logf("info", "pipe: klient połączony");
        log_forward_enable(true);
        FrameDecoder decoder(gen::kMaxFrameBytes);
        std::vector<char> rbuf(16 * 1024);
        helloDirty.store(false);
        session.update_hello(take_hello());
        session.on_connect(now_ms());

        OVERLAPPED ovr{};
        ovr.hEvent = evRead.h;
        bool readPending = false;
        bool alive = !session.send_failed();
        std::string payload;
        std::vector<std::pair<std::string, std::string>> logs;

        while (alive && WaitForSingleObject(stop.h, 0) != WAIT_OBJECT_0) {
            if (!readPending) {
                ResetEvent(evRead.h);
                DWORD n = 0;
                if (!ReadFile(pipe, rbuf.data(), static_cast<DWORD>(rbuf.size()), &n, &ovr)) {
                    if (GetLastError() != ERROR_IO_PENDING) break;  // BROKEN_PIPE itp.
                }
                readPending = true;
            }
            const HANDLE hs[3] = {stop.h, evRead.h, wake.h};
            const uint64_t now = now_ms();
            const DWORD w = WaitForMultipleObjects(3, hs, FALSE, session.wait_ms(now));
            if (w == WAIT_OBJECT_0) break;
            if (w == WAIT_OBJECT_0 + 1) {
                DWORD n = 0;
                readPending = false;
                if (!GetOverlappedResult(pipe, &ovr, &n, FALSE) || n == 0) break;  // klient się rozłączył
                decoder.feed(rbuf.data(), n);
                FrameDecoder::Result r;
                while ((r = decoder.next(payload)) == FrameDecoder::Result::Frame) session.on_payload(payload, now_ms());
                if (r == FrameDecoder::Result::TooLarge) {
                    logf("error", "pipe: ramka od klienta za duża — rozłączam");
                    break;
                }
            }
            if (helloDirty.exchange(false)) session.update_hello(take_hello());
            session.pump(now_ms());
            log_take_forward(logs);
            for (auto& [lvl, msg] : logs) session.send_log(lvl, msg);
            logs.clear();
            alive = !session.send_failed();
        }

        // ── sprzątanie ──
        log_forward_enable(false);
        if (readPending) {
            CancelIoEx(pipe, &ovr);
            DWORD n;
            GetOverlappedResult(pipe, &ovr, &n, TRUE);
        }
        session.on_disconnect(now_ms());
        DisconnectNamedPipe(pipe);  // niewysłane dane przepadają — klient i tak dostanie pełny stan po ponownym połączeniu
        logf("info", "pipe: klient rozłączony");
    }
};

PipeServer::PipeServer(Core& core, HelloInfo hello) : impl_(std::make_unique<Impl>(core, std::move(hello))) {
    impl_->helloPending = impl_->helloInit;
}

PipeServer::~PipeServer() { stop(); }

void PipeServer::start() {
    if (impl_->running.exchange(true)) return;
    impl_->core.set_wake(&Impl::wake_cb, impl_.get());
    ResetEvent(impl_->stop.h);
    impl_->thread = std::thread([p = impl_.get()] { p->run(); });
}

void PipeServer::stop() {
    if (!impl_->running.exchange(false)) return;
    impl_->core.set_wake(nullptr, nullptr);  // wątek gry przestaje budzić
    SetEvent(impl_->stop.h);
    if (impl_->thread.joinable()) impl_->thread.join();
}

void PipeServer::update_hello(const HelloInfo& h) {
    {
        std::lock_guard lock(impl_->helloMx);
        impl_->helloPending = h;
    }
    impl_->helloDirty.store(true);
    SetEvent(impl_->wake.h);
}

}  // namespace yoga
