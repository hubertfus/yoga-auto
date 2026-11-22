#pragma once
// Lekki JSON: writer (do std::string, wątek IO) i parser do małego DOM-u (komendy z bridge'a, testy).
#include <cstdint>
#include <map>
#include <memory>
#include <string>
#include <string_view>
#include <vector>

namespace yoga {

class JsonWriter {
public:
    explicit JsonWriter(std::string& out) : out_(out) {}

    JsonWriter& begin_object();
    JsonWriter& end_object();
    JsonWriter& begin_array();
    JsonWriter& end_array();
    JsonWriter& key(std::string_view k);

    JsonWriter& value(std::string_view s);
    JsonWriter& value(const char* s) { return value(std::string_view(s ? s : "")); }
    JsonWriter& value(bool b);
    JsonWriter& value(int64_t v);
    JsonWriter& value(uint64_t v);
    JsonWriter& value(int32_t v) { return value(static_cast<int64_t>(v)); }
    JsonWriter& value(uint32_t v) { return value(static_cast<uint64_t>(v)); }
    /// float/double: najkrótsza reprezentacja round-trip; NaN/Inf → null.
    JsonWriter& value(float v);
    JsonWriter& value(double v);
    JsonWriter& null();

    std::string& str() { return out_; }

private:
    void sep();
    std::string& out_;
    // true = w bieżącym kontenerze był już element; stos głębokości
    uint64_t has_items_ = 0;
    int depth_ = 0;
    bool after_key_ = false;
};

void json_escape(std::string& out, std::string_view s);

// ─────────────────────────────── parser ───────────────────────────────

struct JsonValue {
    enum class Type { Null, Bool, Number, String, Array, Object };
    Type type = Type::Null;
    bool b = false;
    double num = 0;
    std::string str;
    std::vector<JsonValue> arr;
    std::vector<std::pair<std::string, JsonValue>> obj;  // kolejność zachowana

    bool is_null() const { return type == Type::Null; }
    bool is_number() const { return type == Type::Number; }
    bool is_string() const { return type == Type::String; }
    bool is_bool() const { return type == Type::Bool; }
    bool is_object() const { return type == Type::Object; }
    bool is_array() const { return type == Type::Array; }

    /// nullptr, gdy brak klucza albo to nie obiekt.
    const JsonValue* find(std::string_view k) const;
};

/// Parsuje cały tekst. false przy błędzie składni albo śmieciach na końcu. Maks. głębokość 64.
bool json_parse(std::string_view text, JsonValue& out);

/// Porównanie strukturalne (kolejność kluczy obiektu bez znaczenia; liczby z tolerancją względną `eps`).
bool json_equal(const JsonValue& a, const JsonValue& b, double eps = 1e-6);

}  // namespace yoga
