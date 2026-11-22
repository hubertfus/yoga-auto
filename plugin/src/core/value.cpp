#include "value.h"

#include <cstring>

namespace yoga {

size_t value_payload_size(scs_value_type_t type) {
    switch (type) {
        case SCS_VALUE_TYPE_bool: return 1;
        case SCS_VALUE_TYPE_s32:
        case SCS_VALUE_TYPE_u32:
        case SCS_VALUE_TYPE_float: return 4;
        case SCS_VALUE_TYPE_u64:
        case SCS_VALUE_TYPE_s64:
        case SCS_VALUE_TYPE_double: return 8;
        case SCS_VALUE_TYPE_fvector:
        case SCS_VALUE_TYPE_euler: return 12;
        case SCS_VALUE_TYPE_dvector:
        case SCS_VALUE_TYPE_fplacement: return 24;
        case SCS_VALUE_TYPE_dplacement: return 36;  // 24 pozycja + 12 orientacja (bez paddingu)
        default: return 0;
    }
}

bool value_equal(const scs_value_t& a, const scs_value_t& b) {
    if (a.type != b.type) return false;
    switch (a.type) {
        case SCS_VALUE_TYPE_bool: return (a.value_bool.value != 0) == (b.value_bool.value != 0);
        case SCS_VALUE_TYPE_string: return a.value_string.value == b.value_string.value;
        default: {
            const size_t n = value_payload_size(a.type);
            // Wszystkie typy liczbowe zaczynają się od początku unii; dplacement: 36 B bez paddingu.
            return n == 0 || std::memcmp(&a.value_u64, &b.value_u64, n) == 0;
        }
    }
}

namespace {
void write_xyz(JsonWriter& w, double x, double y, double z) {
    w.key("x").value(x).key("y").value(y).key("z").value(z);
}
void write_hpr(JsonWriter& w, const scs_value_euler_t& e) {
    w.key("heading").value(e.heading).key("pitch").value(e.pitch).key("roll").value(e.roll);
}
void write_numeric(JsonWriter& w, const scs_value_t& v) {
    switch (v.type) {
        case SCS_VALUE_TYPE_bool: w.value(v.value_bool.value != 0); break;
        case SCS_VALUE_TYPE_s32: w.value(v.value_s32.value); break;
        case SCS_VALUE_TYPE_u32: w.value(v.value_u32.value); break;
        case SCS_VALUE_TYPE_u64: w.value(static_cast<uint64_t>(v.value_u64.value)); break;
        case SCS_VALUE_TYPE_s64: w.value(static_cast<int64_t>(v.value_s64.value)); break;
        case SCS_VALUE_TYPE_float: w.value(v.value_float.value); break;
        case SCS_VALUE_TYPE_double: w.value(v.value_double.value); break;
        case SCS_VALUE_TYPE_fvector:
            w.begin_object();
            // float → JSON przez float (najkrótszy zapis), nie przez double
            w.key("x").value(v.value_fvector.x).key("y").value(v.value_fvector.y).key("z").value(v.value_fvector.z);
            w.end_object();
            break;
        case SCS_VALUE_TYPE_dvector:
            w.begin_object();
            write_xyz(w, v.value_dvector.x, v.value_dvector.y, v.value_dvector.z);
            w.end_object();
            break;
        case SCS_VALUE_TYPE_euler:
            w.begin_object();
            write_hpr(w, v.value_euler);
            w.end_object();
            break;
        case SCS_VALUE_TYPE_fplacement: {
            const auto& p = v.value_fplacement;
            w.begin_object();
            w.key("x").value(p.position.x).key("y").value(p.position.y).key("z").value(p.position.z);
            write_hpr(w, p.orientation);
            w.end_object();
            break;
        }
        case SCS_VALUE_TYPE_dplacement: {
            const auto& p = v.value_dplacement;
            w.begin_object();
            write_xyz(w, p.position.x, p.position.y, p.position.z);
            write_hpr(w, p.orientation);
            w.end_object();
            break;
        }
        default: w.null(); break;
    }
}
}  // namespace

void write_value(JsonWriter& w, const scs_value_t& v) {
    if (v.type == SCS_VALUE_TYPE_string) {
        w.value(v.value_string.value ? v.value_string.value : "");
        return;
    }
    write_numeric(w, v);
}

void write_value(JsonWriter& w, const OwnedValue& v) {
    if (v.v.type == SCS_VALUE_TYPE_string) {
        w.value(std::string_view(v.s));
        return;
    }
    write_numeric(w, v.v);
}

}  // namespace yoga
