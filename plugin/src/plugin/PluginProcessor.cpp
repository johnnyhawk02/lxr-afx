#include "PluginProcessor.h"

#include "../engine/Wavetables.h"
#include "PluginEditor.h"

LxrProcessor::LxrProcessor()
    : AudioProcessor(BusesProperties().withOutput("Output", juce::AudioChannelSet::stereo(), true)) {
  // the built-in wavetables take a moment to make: never on the audio thread (the voices get them when they're made)
  tableThread = std::thread([this] { lxr::buildAllTables(); tablesMade = true; });
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
  try { push(lxr::json::parse(message.toStdString())); } catch (...) {}
}

void LxrProcessor::pageState(const juce::String& message) {
  try {
    auto j = lxr::json::parse(message.toStdString());
    std::lock_guard<std::mutex> l(stateMx);
    if (j.contains("store") && j["store"].is_string()) storeText = j["store"].get<std::string>();
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
    j = {{"lxrAfx", 1}, {"store", storeText.empty() ? lxr::json() : lxr::json(storeText)}, {"keys", keys.is_array() ? keys : lxr::json::array()}};
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
      restore["keys"] = keys;
    }
    push(std::move(restore));
    gen++;
  } catch (...) {}
}

juce::AudioProcessorEditor* LxrProcessor::createEditor() { return new LxrEditor(*this); }

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() { return new LxrProcessor(); }
