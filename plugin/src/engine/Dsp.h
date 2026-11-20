// plugin/js/dsp-entry.js in C++: the instrument as the plugin drives it. The page's messages (the AudioWorklet's, as
// sound/worklet.js takes them, plus 'keys' and 'restore'), the DAW's MIDI (notes play here, through the key table the
// page sends, mono per zone, last-note priority, as app/main.js keyDown / noteOff), and the meters back to the page.
// Not thread-safe: the plugin calls everything from its audio thread.
#pragma once
#include <array>
#include <memory>
#include <string>

#include "Instrument.h"

namespace lxr {

class Dsp {
 public:
  void init(double sampleRate);
  bool ready() const { return inst != nullptr; }
  void render(float* left, float* right, int n);
  void msg(const std::string& text);
  void msg(const json& m);
  void midi(int status, int d1, int d2);
  /** '' or the 'peaks' message for the page's meters, about 30 times a second */
  std::string poll();
  /** the wavetables were made: hand them to the voices */
  void retable() { if (inst) inst->retable(); }
  /** the MACRO knobs: the plugin's parameters set them (host: the page's 'fx' no longer does), k 0..7, v 0..127 */
  void setMacroHost(bool host) { macroHost = host; if (inst) inst->macroHost = host; }
  void setMacro(int k, double v) { if (inst) inst->setMacro(k, v); }
  std::string lastError;

 private:
  struct Key { bool on = false; int sound = 0; double play = 60; Params params; };
  struct HeldKey { int note; int vel; };
  void keyDown(int note, int vel);
  void keyUp(int note);
  void allOff();
  std::unique_ptr<Instrument> inst;
  double rate = 48000; int n30 = 0; bool macroHost = false;
  json lastKit, lastFx; int lastEngines = 0;
  std::array<Key, 128> keys;
  std::array<std::vector<HeldKey>, 6> held;
};

/** [[par, value], ...] as Params */
Params paramsOf(const json& a);

}  // namespace lxr
