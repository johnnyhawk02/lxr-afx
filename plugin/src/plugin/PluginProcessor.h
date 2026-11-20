// The plugin: the C++ engine (../engine, a port of the web app's sound/ + engine/) on the DAW's audio thread, playing
// the DAW's MIDI, with the web app itself as the editor (PluginEditor). What the page says goes to the engine through
// a queue; the meters come back the same way. The page's state (its localStorage) is kept in the DAW's project.
#pragma once
#include <juce_audio_processors/juce_audio_processors.h>

#include <atomic>
#include <mutex>
#include <thread>

#include "../engine/Dsp.h"

class LxrProcessor : public juce::AudioProcessor {
 public:
  LxrProcessor();
  ~LxrProcessor() override;

  void prepareToPlay(double sampleRate, int samplesPerBlock) override;
  void releaseResources() override {}
  bool isBusesLayoutSupported(const BusesLayout& layouts) const override;
  void processBlock(juce::AudioBuffer<float>&, juce::MidiBuffer&) override;
  using AudioProcessor::processBlock;

  juce::AudioProcessorEditor* createEditor() override;
  bool hasEditor() const override { return true; }
  const juce::String getName() const override { return JucePlugin_Name; }
  bool acceptsMidi() const override { return true; }
  bool producesMidi() const override { return false; }
  bool isMidiEffect() const override { return false; }
  double getTailLengthSeconds() const override { return 2.0; }
  int getNumPrograms() override { return 1; }
  int getCurrentProgram() override { return 0; }
  void setCurrentProgram(int) override {}
  const juce::String getProgramName(int) override { return {}; }
  void changeProgramName(int, const juce::String&) override {}
  void getStateInformation(juce::MemoryBlock& destData) override;
  void setStateInformation(const void* data, int sizeInBytes) override;

  // ---- from the editor (message thread) ----
  /** one of the page's AudioWorklet messages (JSON) */
  void fromPage(const juce::String& message);
  /** the page saved: its localStorage state and the whole key table */
  void pageState(const juce::String& message);
  /** the page's saved state, for the next page that opens (null when there's none yet) */
  lxr::json store() const;
  /** the latest meters ('' when none since the last call), and the DAW's MIDI since the last call, as [[st,d1,d2],...] */
  std::string takePeaks();
  std::string takeMidi();
  /** bumps when a project is loaded, so an open editor reloads its page with that state */
  int generation() const { return gen.load(); }
  /** the MACRO knobs as DAW parameters (-1..1, 0 in the middle), so a DAW can automate and map them */
  static constexpr int NUM_MACROS = 8;
  juce::AudioParameterFloat* macros[NUM_MACROS] = {};
  double rate() const { return sr.load(); }

 private:
  void push(lxr::json m);
  void macroFromPage(const lxr::json& m);
  void macrosFromStore(const std::string& store);
  float macroNow[NUM_MACROS];
  lxr::Dsp dsp;
  std::atomic<double> sr{48000};
  std::mutex inMx; std::vector<lxr::json> inbox, work;
  std::mutex outMx; std::string peaks, midiOut;
  mutable std::mutex stateMx; std::string storeText; lxr::json keys;
  std::atomic<int> gen{0};
  std::atomic<bool> tablesMade{false}; bool tablesGiven = false;
  std::thread tableThread;
  std::vector<float> scratch;
  JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(LxrProcessor)
};
