#pragma once
// Rekordy zdarzeń wątek gry → wątek IO (config / gameplay / input.active).
// Wątek gry koduje binarnie do SpscByteRing (bez alokacji, bez JSON); wątek IO dekoduje i serializuje.
#include <scssdk_value.h>

#include <cstdint>
#include <cstring>
#include <string>
#include <string_view>
#include <vector>

#include "value.h"

namespace yoga {

enum class EventKind : uint8_t { Config = 1, Gameplay = 2, InputActive = 3, Log = 4 };

struct EventAttr {
    std::string name;
    uint32_t index = SCS_U32_NIL;
    OwnedValue value;
};

struct EventRecord {
    EventKind kind = EventKind::Config;
    std::string id;
    std::vector<EventAttr> attrs;
};

namespace detail {
struct CountSink {
    size_t n = 0;
    void write(const void*, size_t len) { n += len; }
};

template <typename Sink>
void put_u8(Sink& s, uint8_t v) { s.write(&v, 1); }
template <typename Sink>
void put_u16(Sink& s, uint16_t v) { s.write(&v, 2); }
template <typename Sink>
void put_u32(Sink& s, uint32_t v) { s.write(&v, 4); }

template <typename Sink>
void put_str16(Sink& s, const char* str) {
    size_t len = str ? std::strlen(str) : 0;
    if (len > 0xFFFF) len = 0xFFFF;
    put_u16(s, static_cast<uint16_t>(len));
    if (len) s.write(str, len);
}

template <typename Sink>
void encode_value(Sink& s, const scs_value_t& v) {
    put_u32(s, v.type);
    if (v.type == SCS_VALUE_TYPE_string) {
        const char* str = v.value_string.value;
        const uint32_t len = str ? static_cast<uint32_t>(std::strlen(str)) : 0;
        put_u32(s, len);
        if (len) s.write(str, len);
        return;
    }
    if (v.type == SCS_VALUE_TYPE_bool) {
        put_u8(s, v.value_bool.value ? 1 : 0);
        return;
    }
    const size_t n = value_payload_size(v.type);
    if (n) s.write(&v.value_u64, n);
}

/// Format: u8 kind | str16 id | u16 count | count × (str16 name | u32 index | value)
/// value: u32 type | payload (bool: 1 B, string: u32 len + bajty, reszta: value_payload_size)
template <typename Sink>
void encode_event(Sink& s, EventKind kind, const char* id, const scs_named_value_t* attrs) {
    put_u8(s, static_cast<uint8_t>(kind));
    put_str16(s, id);
    uint16_t count = 0;
    if (attrs)
        for (const scs_named_value_t* a = attrs; a->name && count < 0xFFFF; ++a) ++count;
    put_u16(s, count);
    for (uint16_t k = 0; k < count; ++k) {
        put_str16(s, attrs[k].name);
        put_u32(s, attrs[k].index);
        encode_value(s, attrs[k].value);
    }
}
}  // namespace detail

/// Wrzuca zdarzenie do pierścienia. Bez alokacji. false = brak miejsca (zdarzenie gubione).
template <typename Ring>
bool push_event(Ring& ring, EventKind kind, const char* id, const scs_named_value_t* attrs) {
    detail::CountSink count;
    detail::encode_event(count, kind, id, attrs);
    if (!ring.begin(static_cast<uint32_t>(count.n))) return false;
    detail::encode_event(ring, kind, id, attrs);
    ring.commit();
    return true;
}

/// Bez alokacji: input.active jako zdarzenie z jednym atrybutem bool "active".
template <typename Ring>
bool push_input_active(Ring& ring, const char* device, bool active) {
    scs_named_value_t attrs[2]{};
    attrs[0].name = "active";
    attrs[0].index = SCS_U32_NIL;
    attrs[0].value.type = SCS_VALUE_TYPE_bool;
    attrs[0].value.value_bool.value = active ? 1 : 0;
    attrs[1].name = nullptr;
    return push_event(ring, EventKind::InputActive, device, attrs);
}

bool decode_event(const uint8_t* data, size_t len, EventRecord& out);

}  // namespace yoga
