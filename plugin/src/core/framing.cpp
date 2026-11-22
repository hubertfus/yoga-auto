#include "framing.h"

namespace yoga {

bool append_frame(std::string& out, std::string_view payload, uint32_t maxBytes) {
    if (payload.size() > maxBytes) return false;
    const auto n = static_cast<uint32_t>(payload.size());
    const char head[4] = {static_cast<char>(n & 0xFF), static_cast<char>((n >> 8) & 0xFF),
                          static_cast<char>((n >> 16) & 0xFF), static_cast<char>((n >> 24) & 0xFF)};
    out.append(head, 4);
    out.append(payload);
    return true;
}

void FrameDecoder::feed(const void* data, size_t n) {
    if (pos_ > 0 && pos_ == buf_.size()) {
        buf_.clear();
        pos_ = 0;
    } else if (pos_ > 64 * 1024) {
        buf_.erase(0, pos_);
        pos_ = 0;
    }
    buf_.append(static_cast<const char*>(data), n);
}

FrameDecoder::Result FrameDecoder::next(std::string& payload) {
    if (buf_.size() - pos_ < 4) return Result::NeedMore;
    const auto* p = reinterpret_cast<const unsigned char*>(buf_.data() + pos_);
    const uint32_t len = uint32_t{p[0]} | (uint32_t{p[1]} << 8) | (uint32_t{p[2]} << 16) | (uint32_t{p[3]} << 24);
    if (len > max_) return Result::TooLarge;
    if (buf_.size() - pos_ - 4 < len) return Result::NeedMore;
    payload.assign(buf_, pos_ + 4, len);
    pos_ += 4 + size_t{len};
    return Result::Frame;
}

}  // namespace yoga
