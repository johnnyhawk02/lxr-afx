// The editor: the web app's own page (index.html, app/, css/... as the repo has them, zipped into the plugin) in a
// webview, with plugin/js/shim.js run first so the page's audio, MIDI and storage go to the plugin.
#pragma once
#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_gui_extra/juce_gui_extra.h>

#include "PluginProcessor.h"

class LxrEditor : public juce::AudioProcessorEditor, private juce::Timer {
 public:
  explicit LxrEditor(LxrProcessor&);
  ~LxrEditor() override;
  void resized() override;
  void paint(juce::Graphics& g) override { g.fillAll(juce::Colour(0xff1b1d1c)); }

 private:
  void timerCallback() override;
  void open();
  LxrProcessor& proc;
  std::unique_ptr<juce::WebBrowserComponent> web;
  int gen = 0;
  JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(LxrEditor)
};
