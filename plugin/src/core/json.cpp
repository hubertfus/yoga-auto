#include "json.h"

#include <charconv>
#include <cmath>
#include <cstdlib>

namespace yoga {

// ─────────────────────────────── writer ───────────────────────────────

void json_escape(std::string& out, std::string_view s) {
    static const char* hex = "0123456789abcdef";
    out.push_back('"');
    for (const char ch : s) {
        const auto c = static_cast<unsigned char>(ch);
        switch (c) {
            case '"': out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\n': out += "\\n"; break;
            case '\r': out += "\\r"; break;
            case '\t': out += "\\t"; break;
            case '\b': out += "\\b"; break;
            case '\f': out += "\\f"; break;
            default:
                if (c < 0x20) {
                    out += "\\u00";
                    out.push_back(hex[c >> 4]);
                    out.push_back(hex[c & 0xF]);
                } else {
                    out.push_back(ch);  // UTF-8 przechodzi bez zmian
                }
        }
    }
    out.push_back('"');
}

void JsonWriter::sep() {
    if (after_key_) {
        after_key_ = false;
        return;
    }
    if (depth_ > 0) {
        const uint64_t bit = uint64_t{1} << (depth_ - 1);
        if (has_items_ & bit) out_.push_back(',');
        has_items_ |= bit;
    }
}

JsonWriter& JsonWriter::begin_object() {
    sep();
    out_.push_back('{');
    ++depth_;
    has_items_ &= ~(uint64_t{1} << (depth_ - 1));
    return *this;
}
JsonWriter& JsonWriter::end_object() {
    out_.push_back('}');
    --depth_;
    return *this;
}
JsonWriter& JsonWriter::begin_array() {
    sep();
    out_.push_back('[');
    ++depth_;
    has_items_ &= ~(uint64_t{1} << (depth_ - 1));
    return *this;
}
JsonWriter& JsonWriter::end_array() {
    out_.push_back(']');
    --depth_;
    return *this;
}
JsonWriter& JsonWriter::key(std::string_view k) {
    sep();
    json_escape(out_, k);
    out_.push_back(':');
    after_key_ = true;
    return *this;
}
JsonWriter& JsonWriter::value(std::string_view s) {
    sep();
    json_escape(out_, s);
    return *this;
}
JsonWriter& JsonWriter::value(bool b) {
    sep();
    out_ += b ? "true" : "false";
    return *this;
}
JsonWriter& JsonWriter::value(int64_t v) {
    sep();
    char buf[24];
    auto r = std::to_chars(buf, buf + sizeof buf, v);
    out_.append(buf, r.ptr);
    return *this;
}
JsonWriter& JsonWriter::value(uint64_t v) {
    sep();
    char buf[24];
    auto r = std::to_chars(buf, buf + sizeof buf, v);
    out_.append(buf, r.ptr);
    return *this;
}
JsonWriter& JsonWriter::value(float v) {
    sep();
    if (!std::isfinite(v)) {
        out_ += "null";
        return *this;
    }
    if (v == 0.0f) v = 0.0f;  // -0 → 0
    char buf[32];
    auto r = std::to_chars(buf, buf + sizeof buf, v);
    out_.append(buf, r.ptr);
    return *this;
}
JsonWriter& JsonWriter::value(double v) {
    sep();
    if (!std::isfinite(v)) {
        out_ += "null";
        return *this;
    }
    if (v == 0.0) v = 0.0;
    char buf[40];
    auto r = std::to_chars(buf, buf + sizeof buf, v);
    out_.append(buf, r.ptr);
    return *this;
}
JsonWriter& JsonWriter::null() {
    sep();
    out_ += "null";
    return *this;
}

// ─────────────────────────────── parser ───────────────────────────────

const JsonValue* JsonValue::find(std::string_view k) const {
    if (type != Type::Object) return nullptr;
    for (const auto& [name, v] : obj)
        if (name == k) return &v;
    return nullptr;
}

namespace {
struct Parser {
    std::string_view s;
    size_t i = 0;
    int depth = 0;

    void ws() {
        while (i < s.size() && (s[i] == ' ' || s[i] == '\t' || s[i] == '\n' || s[i] == '\r')) ++i;
    }
    bool lit(std::string_view w) {
        if (s.substr(i, w.size()) != w) return false;
        i += w.size();
        return true;
    }
    static void utf8(std::string& out, uint32_t cp) {
        if (cp < 0x80) {
            out.push_back(static_cast<char>(cp));
        } else if (cp < 0x800) {
            out.push_back(static_cast<char>(0xC0 | (cp >> 6)));
            out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
        } else if (cp < 0x10000) {
            out.push_back(static_cast<char>(0xE0 | (cp >> 12)));
            out.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3F)));
            out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
        } else {
            out.push_back(static_cast<char>(0xF0 | (cp >> 18)));
            out.push_back(static_cast<char>(0x80 | ((cp >> 12) & 0x3F)));
            out.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3F)));
            out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
        }
    }
    bool hex4(uint32_t& v) {
        if (i + 4 > s.size()) return false;
        v = 0;
        for (int k = 0; k < 4; ++k) {
            const char c = s[i++];
            v <<= 4;
            if (c >= '0' && c <= '9') v |= static_cast<uint32_t>(c - '0');
            else if (c >= 'a' && c <= 'f') v |= static_cast<uint32_t>(c - 'a' + 10);
            else if (c >= 'A' && c <= 'F') v |= static_cast<uint32_t>(c - 'A' + 10);
            else return false;
        }
        return true;
    }
    bool string(std::string& out) {
        if (i >= s.size() || s[i] != '"') return false;
        ++i;
        while (i < s.size()) {
            const char c = s[i++];
            if (c == '"') return true;
            if (static_cast<unsigned char>(c) < 0x20) return false;
            if (c != '\\') {
                out.push_back(c);
                continue;
            }
            if (i >= s.size()) return false;
            const char e = s[i++];
            switch (e) {
                case '"': out.push_back('"'); break;
                case '\\': out.push_back('\\'); break;
                case '/': out.push_back('/'); break;
                case 'b': out.push_back('\b'); break;
                case 'f': out.push_back('\f'); break;
                case 'n': out.push_back('\n'); break;
                case 'r': out.push_back('\r'); break;
                case 't': out.push_back('\t'); break;
                case 'u': {
                    uint32_t cp = 0;
                    if (!hex4(cp)) return false;
                    if (cp >= 0xD800 && cp <= 0xDBFF) {
                        uint32_t lo = 0;
                        if (!lit("\\u") || !hex4(lo) || lo < 0xDC00 || lo > 0xDFFF) return false;
                        cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00);
                    }
                    utf8(out, cp);
                    break;
                }
                default: return false;
            }
        }
        return false;
    }
    bool number(double& out) {
        const size_t start = i;
        if (i < s.size() && s[i] == '-') ++i;
        if (i >= s.size() || !(s[i] >= '0' && s[i] <= '9')) return false;
        while (i < s.size() && ((s[i] >= '0' && s[i] <= '9') || s[i] == '.' || s[i] == 'e' || s[i] == 'E' ||
                                s[i] == '+' || s[i] == '-'))
            ++i;
        auto r = std::from_chars(s.data() + start, s.data() + i, out);
        return r.ec == std::errc{} && r.ptr == s.data() + i;
    }
    bool value(JsonValue& v) {
        if (++depth > 64) return false;
        ws();
        if (i >= s.size()) return false;
        bool ok = true;
        const char c = s[i];
        if (c == '{') {
            v.type = JsonValue::Type::Object;
            ++i;
            ws();
            if (i < s.size() && s[i] == '}') {
                ++i;
            } else {
                for (;;) {
                    ws();
                    std::string k;
                    if (!string(k)) return false;
                    ws();
                    if (i >= s.size() || s[i] != ':') return false;
                    ++i;
                    JsonValue child;
                    if (!value(child)) return false;
                    v.obj.emplace_back(std::move(k), std::move(child));
                    ws();
                    if (i < s.size() && s[i] == ',') { ++i; continue; }
                    if (i < s.size() && s[i] == '}') { ++i; break; }
                    return false;
                }
            }
        } else if (c == '[') {
            v.type = JsonValue::Type::Array;
            ++i;
            ws();
            if (i < s.size() && s[i] == ']') {
                ++i;
            } else {
                for (;;) {
                    JsonValue child;
                    if (!value(child)) return false;
                    v.arr.push_back(std::move(child));
                    ws();
                    if (i < s.size() && s[i] == ',') { ++i; continue; }
                    if (i < s.size() && s[i] == ']') { ++i; break; }
                    return false;
                }
            }
        } else if (c == '"') {
            v.type = JsonValue::Type::String;
            ok = string(v.str);
        } else if (c == 't') {
            v.type = JsonValue::Type::Bool;
            v.b = true;
            ok = lit("true");
        } else if (c == 'f') {
            v.type = JsonValue::Type::Bool;
            ok = lit("false");
        } else if (c == 'n') {
            ok = lit("null");
        } else {
            v.type = JsonValue::Type::Number;
            ok = number(v.num);
        }
        --depth;
        return ok;
    }
};
}  // namespace

bool json_parse(std::string_view text, JsonValue& out) {
    Parser p{text};
    out = JsonValue{};
    if (!p.value(out)) return false;
    p.ws();
    return p.i == text.size();
}

bool json_equal(const JsonValue& a, const JsonValue& b, double eps) {
    if (a.type != b.type) return false;
    switch (a.type) {
        case JsonValue::Type::Null: return true;
        case JsonValue::Type::Bool: return a.b == b.b;
        case JsonValue::Type::Number: {
            const double d = std::fabs(a.num - b.num);
            return d <= eps * (std::fabs(a.num) > 1.0 ? std::fabs(a.num) : 1.0);
        }
        case JsonValue::Type::String: return a.str == b.str;
        case JsonValue::Type::Array:
            if (a.arr.size() != b.arr.size()) return false;
            for (size_t k = 0; k < a.arr.size(); ++k)
                if (!json_equal(a.arr[k], b.arr[k], eps)) return false;
            return true;
        case JsonValue::Type::Object:
            if (a.obj.size() != b.obj.size()) return false;
            for (const auto& [k, v] : a.obj) {
                const JsonValue* o = b.find(k);
                if (!o || !json_equal(v, *o, eps)) return false;
            }
            return true;
    }
    return false;
}

}  // namespace yoga
