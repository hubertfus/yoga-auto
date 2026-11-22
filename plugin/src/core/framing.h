#pragma once
// Ramki IPC: uint32 little-endian długość payloadu + payload UTF-8 JSON (PROTOCOL.md §5, ipc.ts).
#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

namespace yoga {

/// Dopisuje ramkę (nagłówek + payload) do `out`. false, gdy payload > maxBytes.
bool append_frame(std::string& out, std::string_view payload, uint32_t maxBytes);

class FrameDecoder {
public:
    explicit FrameDecoder(uint32_t maxBytes) : max_(maxBytes) {}

    enum class Result { NeedMore, Frame, TooLarge };

    void feed(const void* data, size_t n);
    /// Wyjmuje następną pełną ramkę do `payload`.
    Result next(std::string& payload);
    void clear() {
        buf_.clear();
        pos_ = 0;
    }

private:
    uint32_t max_;
    std::string buf_;
    size_t pos_ = 0;
};

}  // namespace yoga
