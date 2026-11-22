#pragma once
// Wartości SDK (scs_value_t): porównanie, zapis do JSON, kopia „posiadana” (z własnym stringiem).
#include <scssdk_value.h>

#include <string>

#include "json.h"

namespace yoga {

/// Porównuje tylko pola istotne dla typu (bez paddingu). Różne typy = różne.
bool value_equal(const scs_value_t& a, const scs_value_t& b);

/// Zapis zgodny z IpcValue: number | boolean | string | {x,y,z} | {x,y,z,heading,pitch,roll}.
/// euler → {heading,pitch,roll}. Nieznany typ → null.
void write_value(JsonWriter& w, const scs_value_t& v);

/// Kopia wartości z eventu SDK, która przeżyje callback (string skopiowany).
struct OwnedValue {
    scs_value_t v{};  // dla stringu value_string.value nieużywane
    std::string s;
};
void write_value(JsonWriter& w, const OwnedValue& v);

/// Rozmiar zakodowanego payloadu wartości danego typu (bez stringów), 0 = typ nieobsługiwany.
size_t value_payload_size(scs_value_type_t type);

}  // namespace yoga
