// The editor: the web app's own page (index.html, app/, css/... as the repo has them, zipped into the plugin) in a
// webview, with plugin/js/shim.js run first so the page's audio, MIDI and storage go to the plugin. The webview itself
// belongs to the processor (LxrProcessor::page) so it stays loaded while the window is shut: reopening is instant.
#pragma once
#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_gui_extra/juce_gui_extra.h>

#include "PluginProcessor.h"

class LxrEditor : public juce::AudioProcessorEditor, private juce::Timer {
 public:
  explicit LxrEditor(LxrProcessor&);
  ~LxrEditor() override;
  void resized() override;
  // the page's own panel colour (it tells us), so the window never shows black while a page is loading
  void paint(juce::Graphics& g) override;

 private:
  void timerCallback() override;
  void open();
  void show();
  LxrProcessor& proc;
  juce::WebBrowserComponent* web = nullptr;  // proc.page, on this window
  JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(LxrEditor)
};
