#include "Dsp.h"

#include <cmath>
#include <sstream>

#include "Js.h"

namespace lxr {

namespace {
double numOr(const json& m, const char* k, double def) {
  auto it = m.find(k);
  if (it == m.end() || it->is_null()) return def;
  if (it->is_number()) return it->get<double>();
  if (it->is_boolean()) return it->get<bool>() ? 1 : 0;
  return def;
}
bool truthy(const json& m, const char* k) {
  auto it = m.find(k);
  if (it == m.end() || it->is_null()) return false;
  if (it->is_boolean()) return it->get<bool>();
  if (it->is_number()) return it->get<double>() != 0;
  return true;
}
std::vector<double> numbers(const json& a) {
  std::vector<double> v;
  if (a.is_array()) { v.reserve(a.size()); for (auto& x : a) v.push_back(x.is_number() ? x.get<double>() : NAN); }
  else if (a.is_object()) {  // (a typed array that went through JSON.stringify without a replacer: {"0":..,"1":..})
    v.resize(a.size(), NAN);
    for (auto it = a.begin(); it != a.end(); ++it) { const size_t i = std::stoul(it.key()); if (i < v.size() && it->is_number()) v[i] = it->get<double>(); }
  }
  return v;
}
void appendNum(std::string& s, double x) {
  if (!std::isfinite(x)) { s += "null"; return; }
  char b[32]; std::snprintf(b, sizeof b, "%.9g", x); s += b;
}
}  // namespace

Params paramsOf(const json& a) {
  Params p;
  if (!a.is_array()) return p;
  p.reserve(a.size());
  for (auto& e : a) if (e.is_array() && e.size() >= 2 && e[0].is_number()) p.push_back({e[0].get<int>(), e[1].is_number() ? e[1].get<double>() : NAN});
  return p;
}

void Dsp::init(double sampleRate) {
  rate = sampleRate;
  inst = std::make_unique<Instrument>(sampleRate);
  for (auto& h : held) h.clear();
  if (lastEngines) inst->setEngines(lastEngines);
  if (lastKit.is_array()) inst->loadKit(numbers(lastKit));
  if (!lastFx.is_null()) inst->setFx(lastFx);
  n30 = 0;
}

void Dsp::render(float* left, float* right, int n) {
  if (!inst) { std::fill(left, left + n, 0.0f); std::fill(right, right + n, 0.0f); return; }
  inst->render(left, right, n);
  n30 += n;
}

void Dsp::msg(const std::string& text) {
  try { msg(json::parse(text)); } catch (const std::exception& e) { lastError = e.what(); }
}

void Dsp::msg(const json& m) {
  if (!inst || !m.is_object()) return;
  const std::string type = m.value("type", "");
  if (type == "kit") { lastKit = m["values"]; inst->loadKit(numbers(m["values"])); }
  else if (type == "param") inst->setParam((int)numOr(m, "par", -1), numOr(m, "value", NAN));
  else if (type == "fx") { lastFx = m["fx"]; inst->setFx(m["fx"]); }
  else if (type == "engines") { lastEngines = (int)numOr(m, "n", 3); inst->setEngines(lastEngines); }
  else if (type == "release") inst->release((int)numOr(m, "sound", 0) % 6);
  else if (type == "play" || type == "back") {
    const int sound = (int)numOr(m, "sound", 0); if (sound < 0 || sound > 5) return;
    Params p; const bool hasP = m.contains("params") && m["params"].is_array(); if (hasP) p = paramsOf(m["params"]);
    if (type == "play") inst->play(sound, numOr(m, "note", 60), numOr(m, "vel", 100), hasP ? &p : nullptr, !(m.contains("hold") && m["hold"].is_boolean() && !m["hold"].get<bool>()), truthy(m, "glide"));
    else inst->back(sound, numOr(m, "note", 60), numOr(m, "vel", 100), hasP ? &p : nullptr, truthy(m, "glide"));
  } else if (type == "keys") {
    if (truthy(m, "full")) for (auto& k : keys) k = Key{};
    if (m.contains("keys") && m["keys"].is_array())
      for (auto& e : m["keys"]) {
        if (!e.is_array() || e.size() < 4) continue;
        const int note = e[0].get<int>(); if (note < 0 || note > 127) continue;
        Key& k = keys[note]; k.on = true; k.sound = e[1].get<int>() % 6; k.play = e[2].get<double>(); k.params = paramsOf(e[3]);
      }
    if (m.contains("drop") && m["drop"].is_array()) for (auto& n : m["drop"]) { const int note = n.get<int>(); if (note >= 0 && note < 128) keys[note] = Key{}; }
  } else if (type == "restore") {
    const json& s = m.contains("store") ? m["store"] : json();
    if (s.is_object() && s.contains("values")) {
      if (s.contains("engines") && s["engines"].is_number()) msg(json{{"type", "engines"}, {"n", s["engines"]}});
      msg(json{{"type", "kit"}, {"values", s["values"]}});
      if (s.contains("fx") && s["fx"].is_object()) msg(json{{"type", "fx"}, {"fx", s["fx"]}});
    }
    if (m.contains("keys") && m["keys"].is_array()) msg(json{{"type", "keys"}, {"full", true}, {"keys", m["keys"]}});
    for (auto& h : held) h.clear();
  }
}

void Dsp::keyDown(int note, int vel) {
  const Key& k = keys[note]; if (!k.on) return;
  auto& st = held[k.sound];
  for (size_t i = 0; i < st.size(); i++) if (st[i].note == note) { st.erase(st.begin() + i); break; }
  st.push_back({note, vel});
  inst->play(k.sound, k.play, vel, &k.params, true, true);
}
void Dsp::keyUp(int note) {
  const Key& k = keys[note]; if (!k.on) return;
  auto& st = held[k.sound];
  int i = -1; for (size_t j = 0; j < st.size(); j++) if (st[j].note == note) { i = (int)j; break; }
  if (i < 0) return;
  st.erase(st.begin() + i);
  if (i < (int)st.size()) return;
  if (st.empty()) { inst->release(k.sound); return; }
  const HeldKey prev = st.back(); const Key& p = keys[prev.note];
  if (p.on) inst->back(k.sound, p.play, prev.vel, &p.params, true);
}
void Dsp::allOff() { for (int s = 0; s < 6; s++) if (!held[s].empty()) { held[s].clear(); inst->release(s); } }

void Dsp::midi(int st, int d1, int d2) {
  if (!inst) return;
  const int t = st & 0xf0, ch = (st & 0x0f) + 1;
  if (ch != 1) return;
  if (d1 < 0 || d1 > 127) return;
  if (t == 0x90 && d2 > 0) keyDown(d1, d2);
  else if (t == 0x80 || t == 0x90) keyUp(d1);
  else if (t == 0xb0 && (d1 == 120 || d1 == 123)) allOff();
}

std::string Dsp::poll() {
  if (!inst || n30 < rate / 30) return {};
  n30 = 0;
  std::string s = "{\"type\":\"peaks\",\"peaks\":[";
  auto list = [&](const std::vector<double>& v) { for (size_t i = 0; i < v.size(); i++) { if (i) s += ','; appendNum(s, v[i]); } };
  list(inst->readPeaks());
  s += "],\"gr\":"; appendNum(s, inst->readGr());
  s += ",\"out\":["; list(inst->readOut());
  s += "],\"steps\":["; { auto st = inst->readSteps(); for (size_t i = 0; i < st.size(); i++) { if (i) s += ','; s += std::to_string(st[i]); } }
  s += "],\"waves\":["; for (int v = 0; v < 6; v++) { if (v) s += ','; appendNum(s, inst->e.voices[v].osc.wraw); }
  s += "],\"mods\":[";
  for (int v = 0; v < 6; v++) {
    if (v) s += ',';
    s += '['; bool first = true;
    for (auto& r : inst->e.routes[v]) if (r.on) { if (!first) s += ','; first = false; s += '[' + std::to_string(r.dest) + ','; appendNum(s, r.d); s += ']'; }
    s += ']';
  }
  s += "],\"stepAt\":["; for (int v = 0; v < 6; v++) { if (v) s += ','; s += std::to_string((int)inst->e.stepPlayed[v]); }
  s += "]}";
  return s;
}

}  // namespace lxr
