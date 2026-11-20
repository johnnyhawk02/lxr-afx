// sound/instrument.js and sound/dirt.js, ported: seven sounds on the engine's six voices, the echo and reverb sends,
// the master (distortion, compressor, level, soft limit) and the resampling from the engine's 44 140 Hz.
#pragma once
#include <memory>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "../../third_party/json.hpp"
#include "LxrEngine.h"

namespace lxr {

using Params = std::vector<std::pair<int, double>>;
using json = nlohmann::json;

// sound/dirt.js
class Dirt {
 public:
  explicit Dirt(double fs);
  void set(const json& s);
  bool active() const { return p[ON] != 0 || wet > 1e-4; }
  void process(float* L, float* R, int n);
  enum { ON, PREGAIN, CUTOFF, SWAP, XOVER, GAIN, CLIP, BASS, TONE, DIRTY, CLEAN, NUM_P };
 private:
  struct Svf { double s1 = 0, s2 = 0, lp = 0, bp = 0, hp = 0; };
  struct Clip { double u1 = 0; double run(double x, double t, double b); };
  struct Channel { Svf filt; Clip c1, c2; double dc = 0, dcX = 0, lp = 0, hp = 0, hpX = 0, low = 0; };
  double fs, p[NUM_P];
  // the gliding knobs, in dirt.js's order: pregain, cutoff, gain, tone, bass, dirty, clean
  double cur[7];
  Channel ch[2];
  double wet = 0, glide, k, co[3], aDc, aLp, aHp, aLow;
};

class Instrument {
 public:
  explicit Instrument(double sampleRate);
  void loadKit(const std::vector<double>& values);
  void setParam(int par, double value);
  void setFx(const json& fx);
  /** the MACRO knobs (FX_DEFAULTS.macros): their targets, and their settings unless macroHost */
  void setMacros(const json& m);
  /** one MACRO knob's setting, 0..127 */
  void setMacro(int k, double v);
  double macro(int k) const { return k >= 0 && k < NUM_MACROS ? macroV[k] : 0; }
  static constexpr int NUM_MACROS = 8;
  /** the plugin: the DAW's parameters set the macros (setMacro), not the page's 'fx' */
  bool macroHost = false;
  void setEngines(int n);
  void play(int sound, double note, double velocity, const Params* params, bool hold, bool glide);
  void back(int sound, double note, double vel, const Params* params, bool glide);
  void release(int sound) { held[sound].on = false; backs[sound].on = false; }
  void render(float* left, float* right, int n);
  /** the wavetables were made (on another thread): every voice's TABLE again */
  void retable();

  std::vector<double> readPeaks();
  double readGr() { const double g = gr; gr = 0; return g; }
  std::vector<double> readOut() { std::vector<double> r{outPk[0], outPk[1], outPk[2], outPk[3]}; for (auto& o : outPk) o = 0; return r; }
  std::vector<int> readSteps() { std::vector<int> r; for (auto& h : held) r.push_back(h.on ? h.cur : -1); return r; }

  LxrEngine e;

 private:
  struct Held { bool on = false; double note = 0, vel = 0, at = 0; int step = 0, cur = -1; };
  struct Back { bool on = false; double at = 0, note = 0, vel = 0; Params params; bool glide = false; };
  struct Glide { bool on = false; std::vector<int> pars; std::vector<double> a, b; double t = 0, dt = 0; int voice = 0; };

  void set(int par, double value);
  void glideTo(int sound, const Params& params);
  void stepGlide(Glide& g);
  void hit(int sound, double vel, double note);
  void setBpm(double bpm);
  void block(float* L, float* R);
  void master(float* L, float* R);
  const Wavetable* tableFor(double value) const;

  double tableOf[6] = {};
  double ratio, gain = 0.8;
  float A[2][BLOCK] = {}, B[2][BLOCK] = {};
  bool aIsFirst = true;
  int idx = 0; double frac = 0;
  float peak[6] = {};
  float sends[2][6] = {};
  float trim[6], trimNow[6];
  EchoBus echo; ReverbBus verb;
  float ret[3] = {1, 1, 1};
  float busIn[BLOCK * 2] = {}; int16_t busOut[BLOCK * 2] = {};
  bool verbPost = false; float postL[BLOCK] = {}, postR[BLOCK] = {};
  uint8_t seqOn[6] = {}, seqPat[6];
  Held held[6]; double bpm = 120;
  double beat = 0; int retQ = 2; Back backs[6];
  Dirt dirt;
  struct Master { double thresh, ratio, attack, release, knee, makeup, level; } m{};
  double env = 0, gr = 0;
  float outPk[4] = {};
  double duck = 0, duckEnv = 0; float duckG[BLOCK]; double duckA, duckR;
  std::vector<double> cur;
  Glide glides[6];
  double morphMs = 0;
  double macroV[NUM_MACROS] = {}, macroCur[NUM_MACROS] = {}, macroCoef = 0;
  std::vector<std::pair<int, double>> macroT[NUM_MACROS];
  void macros();
  float trimBuf[6][BLOCK] = {};
};

}  // namespace lxr
