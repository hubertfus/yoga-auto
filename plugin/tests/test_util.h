#pragma once
// Pomocnicze funkcje testów: wczytywanie fixtur z shared/protocol i budowanie wartości SDK.
#include <scssdk_value.h>

#include <fstream>
#include <sstream>
#include <string>

#include "json.h"

namespace testutil {

inline std::string read_fixture(const char* name) {
    std::ifstream f(std::string(FIXTURE_DIR) + "/" + name, std::ios::binary);
    std::stringstream ss;
    ss << f.rdbuf();
    return ss.str();
}

inline yoga::JsonValue parse(const std::string& s) {
    yoga::JsonValue v;
    if (!yoga::json_parse(s, v)) v.type = yoga::JsonValue::Type::Null;
    return v;
}

inline scs_value_t vfloat(float x) {
    scs_value_t v{};
    v.type = SCS_VALUE_TYPE_float;
    v.value_float.value = x;
    return v;
}
inline scs_value_t vbool(bool b) {
    scs_value_t v{};
    v.type = SCS_VALUE_TYPE_bool;
    v.value_bool.value = b ? 1 : 0;
    return v;
}
inline scs_value_t vs32(int32_t x) {
    scs_value_t v{};
    v.type = SCS_VALUE_TYPE_s32;
    v.value_s32.value = x;
    return v;
}
inline scs_value_t vstr(const char* s) {
    scs_value_t v{};
    v.type = SCS_VALUE_TYPE_string;
    v.value_string.value = s;
    return v;
}
inline scs_value_t vplace(double x, double y, double z, float h, float p, float r) {
    scs_value_t v{};
    v.type = SCS_VALUE_TYPE_dplacement;
    v.value_dplacement.position = {x, y, z};
    v.value_dplacement.orientation = {h, p, r};
    return v;
}

}  // namespace testutil
