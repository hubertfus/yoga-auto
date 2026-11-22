#include "ipc_msgs.h"

#include <cmath>

#include "json.h"
#include "value.h"

namespace yoga {

void build_hello(std::string& out, const HelloInfo& h) {
    JsonWriter w(out);
    w.begin_object();
    w.key("t").value("hello");
    w.key("ipc").value(1);
    w.key("plugin").begin_object().key("name").value("yoga-auto").key("version").value(h.pluginVersion).end_object();
    w.key("game")
        .begin_object()
        .key("id")
        .value(h.gameId)
        .key("name")
        .value(h.gameName)
        .key("version")
        .value(h.gameVersion)
        .end_object();
    w.key("api").begin_object().key("telemetry").value(h.apiTelemetry);
    w.key("input");
    if (h.apiInput.empty()) w.null();
    else w.value(h.apiInput);
    w.end_object();
    w.key("channels").begin_array();
    for (const auto& c : h.channels) w.value(c);
    w.end_array();
    w.key("inputs").begin_object();
    w.key("semantical").begin_array();
    for (const auto& c : h.semantical) w.value(c);
    w.end_array();
    w.key("generic").begin_array();
    for (const auto& c : h.generic) w.value(c);
    w.end_array();
    w.end_object();
    w.key("inputEnabled").value(h.inputEnabled);
    w.end_object();
}

bool build_tel(std::string& out, const Snapshot& cur, const Snapshot* prev, const SlotTable& slots) {
    const bool pausedChanged = !prev || prev->paused != cur.paused;
    std::string body;
    JsonWriter w(body);
    w.begin_object();
    w.key("t").value("tel");
    w.key("frame").value(cur.frame);
    w.key("simTime").value(cur.simTime);
    w.key("renderTime").value(cur.renderTime);
    w.key("paused").value(cur.paused != 0);
    w.key("ch").begin_object();
    uint32_t changed = 0;
    const uint32_t n = cur.count < slots.names.size() ? cur.count : static_cast<uint32_t>(slots.names.size());
    for (uint32_t i = 0; i < n; ++i) {
        const scs_value_t& v = cur.values[i];
        if (v.type == SCS_VALUE_TYPE_INVALID) continue;
        if (prev && value_equal(v, prev->values[i])) continue;
        w.key(slots.names[i]);
        write_value(w, v);
        ++changed;
    }
    w.end_object();
    w.end_object();
    if (changed == 0 && !pausedChanged) return false;
    out.append(body);
    return true;
}

namespace {
void write_attr_object(JsonWriter& w, const EventRecord& e) {
    // Atrybuty indeksowane (index != NIL) o tej samej nazwie → tablica; reszta → wartość.
    std::vector<size_t> done(e.attrs.size(), 0);
    w.begin_object();
    for (size_t i = 0; i < e.attrs.size(); ++i) {
        if (done[i]) continue;
        const EventAttr& a = e.attrs[i];
        w.key(a.name);
        if (a.index == SCS_U32_NIL) {
            write_value(w, a.value);
            done[i] = 1;
            continue;
        }
        uint32_t maxIdx = 0;
        for (size_t j = i; j < e.attrs.size(); ++j)
            if (e.attrs[j].name == a.name && e.attrs[j].index != SCS_U32_NIL && e.attrs[j].index > maxIdx)
                maxIdx = e.attrs[j].index;
        if (maxIdx > 4096) maxIdx = 4096;  // ochrona przed absurdem
        w.begin_array();
        for (uint32_t idx = 0; idx <= maxIdx; ++idx) {
            const EventAttr* hit = nullptr;
            for (size_t j = i; j < e.attrs.size(); ++j)
                if (e.attrs[j].name == a.name && e.attrs[j].index == idx) {
                    hit = &e.attrs[j];
                    done[j] = 1;
                    break;
                }
            if (hit) write_value(w, hit->value);
            else w.null();
        }
        w.end_array();
        done[i] = 1;
    }
    w.end_object();
}
}  // namespace

void build_cfg(std::string& out, const EventRecord& e) {
    JsonWriter w(out);
    w.begin_object();
    w.key("t").value("cfg");
    w.key("id").value(e.id);
    w.key("attrs");
    if (e.attrs.empty()) w.null();  // pusta konfiguracja = usunięta (np. brak zlecenia)
    else write_attr_object(w, e);
    w.end_object();
}

void build_evt(std::string& out, const EventRecord& e) {
    JsonWriter w(out);
    w.begin_object();
    w.key("t").value("evt");
    w.key("id").value(e.id);
    w.key("attrs").begin_object();
    for (const auto& a : e.attrs) {
        w.key(a.name);
        write_value(w, a.value);
    }
    w.end_object();
    w.end_object();
}

void build_input_active(std::string& out, const std::string& device, bool active) {
    JsonWriter w(out);
    w.begin_object().key("t").value("input.active").key("device").value(device).key("active").value(active).end_object();
}

void build_ack(std::string& out, uint32_t seq, uint64_t frame, bool ok) {
    JsonWriter w(out);
    w.begin_object().key("t").value("in.ack").key("seq").value(seq).key("frame").value(frame).key("ok").value(ok);
    w.end_object();
}

void build_log(std::string& out, std::string_view level, std::string_view msg) {
    JsonWriter w(out);
    w.begin_object().key("t").value("log").key("level").value(level).key("msg").value(msg).end_object();
}

// ───────────────────────── komendy ─────────────────────────

Command parse_command(std::string_view payload) {
    Command c;
    JsonValue root;
    if (!json_parse(payload, root) || !root.is_object()) return c;
    const JsonValue* t = root.find("t");
    if (!t || !t->is_string()) return c;

    auto get_u32 = [](const JsonValue* v, uint32_t& out) {
        if (!v || !v->is_number() || v->num < 0 || v->num > 4294967295.0 || v->num != std::floor(v->num)) return false;
        out = static_cast<uint32_t>(v->num);
        return true;
    };

    if (t->str == "hb") {
        c.type = Command::Type::Heartbeat;
    } else if (t->str == "releaseAll") {
        c.type = Command::Type::ReleaseAll;
    } else if (t->str == "in") {
        const JsonValue* dev = root.find("device");
        const JsonValue* input = root.find("input");
        const JsonValue* op = root.find("op");
        if (!get_u32(root.find("seq"), c.seq) || !dev || !dev->is_string() || !input || !input->is_string() || !op ||
            !op->is_string())
            return c;
        if (dev->str == "semantical") c.generic = false;
        else if (dev->str == "generic") c.generic = true;
        else return c;
        c.input = input->str;
        if (op->str == "press") c.op = Command::Op::Press;
        else if (op->str == "down") c.op = Command::Op::Down;
        else if (op->str == "up") c.op = Command::Op::Up;
        else if (op->str == "axis") c.op = Command::Op::Axis;
        else return c;
        c.type = Command::Type::Input;
    } else if (t->str == "opts") {
        c.type = Command::Type::Opts;
        if (const JsonValue* v = root.find("inputEnabled"); v && v->is_bool()) {
            c.hasInputEnabled = true;
            c.inputEnabled = v->b;
        }
        if (const JsonValue* v = root.find("telMinIntervalMs"); v && get_u32(v, c.telMinIntervalMs)) {
            c.hasTelMin = true;
            if (c.telMinIntervalMs > 1000) c.telMinIntervalMs = 1000;
        }
    }
    return c;
}

}  // namespace yoga
