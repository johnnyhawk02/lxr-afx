#include "PluginProcessor.h"

#include "../engine/Wavetables.h"
#include "PluginEditor.h"

LxrProcessor::LxrProcessor()
    : AudioProcessor(BusesProperties().withOutput("Output", juce::AudioChannelSet::stereo(), true)) {
  // the built-in wavetables take a moment to make: never on the audio thread (the voices get them when they're made)
  tableThread = std::thread([this] { lxr::buildAllTables(); tablesMade = true; });
  // the eight MACRO knobs (the page's top row): parameters the DAW sees, automates and maps. They are the macros'
  // settings; the page shows them and sets them, the engine reads them every block
  for (int k = 0; k < NUM_MACROS; k++) {
    macros[k] = new juce::AudioParameterFloat(juce::ParameterID{"macro" + juce::String(k + 1), 1}, "Macro " + juce::String(k + 1),
                                              juce::NormalisableRange<float>(0.0f, 1.0f), 0.0f);
    addParameter(macros[k]);
    macroNow[k] = -1;
  }
  for (auto& c : ccMacro) c = -1;
  inbox.reserve(256); work.reserve(256);
}
LxrProcessor::~LxrProcessor() { if (tableThread.joinable()) tableThread.join(); }

bool LxrProcessor::isBusesLayoutSupported(const BusesLayout& l) const {
  const auto o = l.getMainOutputChannelSet();
  return o == juce::AudioChannelSet::stereo() || o == juce::AudioChannelSet::mono();
}

void LxrProcessor::prepareToPlay(double sampleRate, int samplesPerBlock) {
  if (!dsp.ready() || sampleRate != sr.load()) {
    sr = sampleRate;
    dsp.init(sampleRate);  // (keeps the sound, the effects and the key table: a new engine at the new rate)
    dsp.setMacroHost(true);
    for (auto& m : macroNow) m = -1;
    tablesGiven = false;
  }
  scratch.assign((size_t)juce::jmax(samplesPerBlock, 4096), 0.0f);
}

void LxrProcessor::processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer& midi) {
  juce::ScopedNoDenormals noDenormals;
  const int n = buffer.getNumSamples();
  if (!dsp.ready()) { buffer.clear(); return; }
  if (!tablesGiven && tablesMade.load()) { dsp.retable(); tablesGiven = true; }
  {
    std::unique_lock<std::mutex> l(inMx, std::try_to_lock);
    if (l.owns_lock()) work.swap(inbox);
  }
  for (auto& m : work) dsp.msg(m);
  work.clear();
  // the MACRO knobs, as the DAW has them now
  for (int k = 0; k < NUM_MACROS; k++) {
    const float v = macros[k]->get();
    if (v != macroNow[k]) { macroNow[k] = v; dsp.setMacro(k, (double)v * 127); }
  }

  float* L = buffer.getWritePointer(0);
  float* R = buffer.getNumChannels() > 1 ? buffer.getWritePointer(1) : nullptr;
  if (!R && (int)scratch.size() < n) scratch.resize((size_t)n);
  float* Rw = R ? R : scratch.data();
  std::string seen;
  int at = 0;
  for (const auto meta : midi) {
    const int pos = juce::jlimit(at, n, meta.samplePosition);
    if (pos > at) { dsp.render(L + at, Rw + at, pos - at); at = pos; }
    const auto msg = meta.getMessage();
    if (msg.getRawDataSize() < 1 || msg.getRawDataSize() > 3) continue;
    const auto* d = msg.getRawData();
    const int st = d[0], d1 = msg.getRawDataSize() > 1 ? d[1] : 0, d2 = msg.getRawDataSize() > 2 ? d[2] : 0;
    dsp.midi(st, d1, d2);
    const int t = st & 0xf0;
    if (t == 0xb0 && (st & 0x0f) == 0 && d1 < 128) { // channel 1, a CC MIDI LEARN put on a MACRO: its parameter (the DAW hears it)
      const int k = ccMacro[d1].load(std::memory_order_relaxed);
      if (k >= 0 && k < NUM_MACROS) {
        const float v = juce::jlimit(0.0f, 1.0f, d2 / 127.0f);
        if (v != macros[k]->get()) macros[k]->setValueNotifyingHost(v);
        if (v != macroNow[k]) { macroNow[k] = v; dsp.setMacro(k, (double)v * 127); }
      }
    }
    if (t == 0x80 || t == 0x90 || t == 0xb0) {
      if (!seen.empty()) seen += ',';
      seen += '[' + std::to_string(st) + ',' + std::to_string(d1) + ',' + std::to_string(d2) + ']';
    }
  }
  if (at < n) dsp.render(L + at, Rw + at, n - at);
  if (!R) for (int i = 0; i < n; i++) L[i] = 0.5f * (L[i] + Rw[i]);
  for (int c = 2; c < buffer.getNumChannels(); c++) buffer.clear(c, 0, n);
  midi.clear();

  std::string p = dsp.poll();
  if (!p.empty() || !seen.empty()) {
    std::unique_lock<std::mutex> l(outMx, std::try_to_lock);
    if (l.owns_lock()) {
      if (!p.empty()) peaks = std::move(p);
      if (!seen.empty() && midiOut.size() < 65536) { if (!midiOut.empty()) midiOut += ','; midiOut += seen; }
    }
  }
}

void LxrProcessor::push(lxr::json m) {
  std::lock_guard<std::mutex> l(inMx);
  if (inbox.size() < 100000) inbox.push_back(std::move(m));
}

void LxrProcessor::fromPage(const juce::String& message) {
  try {
    auto m = lxr::json::parse(message.toStdString());
    if (m.is_object() && m.value("type", "") == "macro") { macroFromPage(m); return; }
    push(std::move(m));
  } catch (...) {}
}

// a MACRO knob turned on the page (message thread): its parameter, so the DAW hears of it (and records it). g: 1 a
// drag starts, -1 it ends (the DAW's touch), absent a single change
void LxrProcessor::macroFromPage(const lxr::json& m) {
  const int k = m.contains("i") && m["i"].is_number() ? m["i"].get<int>() : -1;
  if (k < 0 || k >= NUM_MACROS) return;
  const int g = m.contains("g") && m["g"].is_number() ? m["g"].get<int>() : 0;
  if (g == 1) macros[k]->beginChangeGesture();
  if (m.contains("v") && m["v"].is_number()) {
    const float v = juce::jlimit(0.0f, 1.0f, (float)(m["v"].get<double>() / 127));
    if (v != macros[k]->get()) { if (g) macros[k]->setValueNotifyingHost(macros[k]->convertTo0to1(v)); else *macros[k] = v; }
  }
  if (g == -1) macros[k]->endChangeGesture();
}

// the page's saved knob map (ccMap: { "21": { "t": "macro", "k": 0 }, ... }): which CCs move which macro
void LxrProcessor::ccFromStore(const std::string& store) {
  int m[128]; for (auto& x : m) x = -1;
  try {
    const auto s = lxr::json::parse(store);
    if (s.is_object() && s.contains("ccMap") && s["ccMap"].is_object())
      for (auto it = s["ccMap"].begin(); it != s["ccMap"].end(); ++it) {
        const auto& t = it.value();
        if (!t.is_object() || t.value("t", "") != "macro" || !t.contains("k") || !t["k"].is_number()) continue;
        const int k = t["k"].get<int>(), cc = juce::String(it.key()).getIntValue();
        if (k >= 0 && k < NUM_MACROS && cc >= 0 && cc < 128) m[cc] = k;
      }
  } catch (...) {}
  for (int i = 0; i < 128; i++) ccMacro[i].store(m[i], std::memory_order_relaxed);
}

// a project's saved page state: its MACRO settings onto the parameters
void LxrProcessor::macrosFromStore(const std::string& store) {
  try {
    const auto s = lxr::json::parse(store);
    if (!s.contains("fx") || !s["fx"].is_object() || !s["fx"].contains("macros")) return;
    const auto& mc = s["fx"]["macros"];
    if (!mc.is_object() || !mc.contains("v") || !mc["v"].is_array()) return;
    for (int k = 0; k < NUM_MACROS && k < (int)mc["v"].size(); k++)
      if (mc["v"][k].is_number()) *macros[k] = juce::jlimit(0.0f, 1.0f, (float)(mc["v"][k].get<double>() / 127));
  } catch (...) {}
}

void LxrProcessor::pageState(const juce::String& message) {
  try {
    auto j = lxr::json::parse(message.toStdString());
    std::lock_guard<std::mutex> l(stateMx);
    if (j.contains("store") && j["store"].is_string()) { storeText = j["store"].get<std::string>(); ccFromStore(storeText); }
    if (j.contains("keys") && j["keys"].is_array()) keys = std::move(j["keys"]);
  } catch (...) {}
}

lxr::json LxrProcessor::store() const {
  std::lock_guard<std::mutex> l(stateMx);
  return storeText.empty() ? lxr::json() : lxr::json(storeText);
}

std::string LxrProcessor::takePeaks() { std::lock_guard<std::mutex> l(outMx); std::string s; s.swap(peaks); return s; }
std::string LxrProcessor::takeMidi() {
  std::lock_guard<std::mutex> l(outMx);
  if (midiOut.empty()) return {};
  std::string s = '[' + midiOut + ']'; midiOut.clear(); return s;
}

void LxrProcessor::getStateInformation(juce::MemoryBlock& destData) {
  lxr::json j;
  {
    std::lock_guard<std::mutex> l(stateMx);
    // the MACRO settings as the DAW has them (automation may have moved them since the page last saved)
    std::string st = storeText;
    if (!st.empty()) try {
      auto s = lxr::json::parse(st);
      if (s.is_object() && s.contains("fx") && s["fx"].is_object()) {
        auto& mc = s["fx"]["macros"];
        if (!mc.is_object()) mc = lxr::json::object();
        lxr::json v = lxr::json::array();
        for (auto* p : macros) v.push_back(std::round(p->get() * 127 * 1000) / 1000);
        mc["v"] = v;
        st = s.dump(-1, ' ', false, lxr::json::error_handler_t::replace);
      }
    } catch (...) {}
    j = {{"lxrAfx", 1}, {"store", st.empty() ? lxr::json() : lxr::json(st)}, {"keys", keys.is_array() ? keys : lxr::json::array()}};
  }
  const std::string s = j.dump(-1, ' ', false, lxr::json::error_handler_t::replace);
  destData.replaceAll(s.data(), s.size());
}

void LxrProcessor::setStateInformation(const void* data, int sizeInBytes) {
  try {
    auto j = lxr::json::parse(std::string(static_cast<const char*>(data), (size_t)sizeInBytes));
    if (!j.is_object() || !j.contains("lxrAfx")) return;
    lxr::json restore = {{"type", "restore"}};
    {
      std::lock_guard<std::mutex> l(stateMx);
      storeText = j["store"].is_string() ? j["store"].get<std::string>() : std::string();
      keys = j["keys"].is_array() ? j["keys"] : lxr::json::array();
      if (!storeText.empty()) restore["store"] = lxr::json::parse(storeText);
      if (!storeText.empty()) macrosFromStore(storeText);
      ccFromStore(storeText);
      restore["keys"] = keys;
    }
    push(std::move(restore));
    gen++;
  } catch (...) {}
}

juce::AudioProcessorEditor* LxrProcessor::createEditor() { return new LxrEditor(*this); }

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() { return new LxrProcessor(); }
