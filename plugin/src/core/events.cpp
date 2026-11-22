#include "events.h"

namespace yoga {

namespace {
struct Reader {
    const uint8_t* p;
    size_t n;
    size_t i = 0;
    bool ok = true;

    bool get(void* dst, size_t len) {
        if (!ok || n - i < len) return ok = false;
        std::memcpy(dst, p + i, len);
        i += len;
        return true;
    }
    template <typename T>
    T num() {
        T v{};
        get(&v, sizeof v);
        return v;
    }
    std::string str(size_t len) {
        if (!ok || n - i < len) {
            ok = false;
            return {};
        }
        std::string s(reinterpret_cast<const char*>(p + i), len);
        i += len;
        return s;
    }
};
}  // namespace

bool decode_event(const uint8_t* data, size_t len, EventRecord& out) {
    Reader r{data, len};
    out = EventRecord{};
    const auto kind = r.num<uint8_t>();
    if (kind < 1 || kind > 4) return false;
    out.kind = static_cast<EventKind>(kind);
    out.id = r.str(r.num<uint16_t>());
    const auto count = r.num<uint16_t>();
    if (!r.ok) return false;
    out.attrs.reserve(count);
    for (uint16_t k = 0; k < count && r.ok; ++k) {
        EventAttr a;
        a.name = r.str(r.num<uint16_t>());
        a.index = r.num<uint32_t>();
        a.value.v.type = r.num<uint32_t>();
        const auto type = a.value.v.type;
        if (type == SCS_VALUE_TYPE_string) {
            a.value.s = r.str(r.num<uint32_t>());
        } else if (type == SCS_VALUE_TYPE_bool) {
            a.value.v.value_bool.value = r.num<uint8_t>();
        } else {
            const size_t sz = value_payload_size(type);
            if (sz) r.get(&a.value.v.value_u64, sz);
        }
        out.attrs.push_back(std::move(a));
    }
    return r.ok && r.i == len;
}

}  // namespace yoga
