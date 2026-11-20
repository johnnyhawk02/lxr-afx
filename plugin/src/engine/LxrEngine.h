// engine/lxr.js, ported to C++ line by line: the LXR firmware's drum engine as the web app runs it (the merged voice,
// morphable switches, wavetables, modulation routes, STEP SEQ), plus the echo (FxBus delay) and the stereo reverb.
// Only what sound/instrument.js uses is here (no crossfeed, no FX-bus distortion/ring/compressor, no renderFx).
#pragma once
#include <array>
#include <cstdint>
#include <vector>

#include "Wavetables.h"

namespace lxr {

constexpr int REAL_FS = 44140;
constexpr int BLOCK = 64;
constexpr int NUM_VOICES = 6;
constexpr int EXTRA_DEST = 1000;
constexpr int NUM_STEPS = 16;
enum { SRC_OFF = 0, SRC_LFO, SRC_VEL, SRC_AMP, SRC_PITCH, SRC_STEP, SRC_MACRO };
enum { KIND_DRUM = 0, KIND_SNARE, KIND_CYM, KIND_HAT };

struct Rng {
  uint32_t state;
  explicit Rng(uint32_t seed = 0x12345678) : state(seed) {}
  uint32_t next() { uint32_t x = state; x ^= x << 13; x ^= x >> 17; x ^= x << 5; state = x; return x; }
};

struct Osc {
  double output = 0; const uint32_t* pm = nullptr; uint32_t phaseInc = 0, phase = 0; double freq = 0; int waveform = 0, tableOffset = 0;
  double pitchMod = 0, fmMod = 0, modNodeValue = 0; int midiFreq = 0, baseNote = 0;
  double coarseFrac = 0, fineFrac = 0;
  const Wavetable* wtab = nullptr; double wpos = 0, wraw = 0, hz = 0;
  int wB = -1; double wt = 0;
};
struct DecayEg { double decay = 0, slope = 0, value = 0; };
struct SlopeEg { double attack = 0, decay = 0, slope = 0, invSlope = 0; int repeat = 0, repeatCnt = 0; double value = 0; int state = 0; };
struct Transient { double phase = 0, pitch = 1; int waveform = 0; double volume = 1; };
struct OnePole { double r, b; };
struct Filter { double f = 0, g = 0, q = 0, s1 = 0, s2 = 0, a = 0, b = 0, drive = 0, ws1 = 0, ws2 = 0, wa = 0, wb = 0; };
struct Lfo { uint32_t phase = 0; double phaseInc = 1; int waveform = 0, retrigger = 0; uint32_t phaseOffset = 0; double rnd = 0; int sync = 0; double freq = 1, modNodeValue = 1; };

struct Voice {
  int kind = 0;
  Osc osc, modOsc, modOsc2, noiseOsc;
  int srcA = 0, srcB = 0, srcN = 0, pitchEg = 0; double fmEnv = 0;
  double extra[18] = {};
  int routeT = 1, routeN = 1, routeC = 1;
  double fmModAmount = 0, fmModAmount2 = 0, mixAmt = 0, mix = 0, carrierGain = 1;
  double vol = 0, velo = 0, pan = 0, triggeredPanL = 0, triggeredPanR = 0;
  DecayEg oscPitchEg; double egPitchModAmount = 0;
  Transient transGen; Lfo lfo; SlopeEg oscVolEg; double egValueOscVol = 0;
  double distShape = 0; OnePole driveFilter;
  Filter filter; int filterType = 0, filterB = 0; double filterT = 0; bool fw = false; double fwTo[7] = {}, fwAt[7] = {}; int fFirm = 0;
  double ampFilterInput = 0, egPitchNow = 0, lastGain = 0, snapValue = 0; int volumeMod = 1; double combinedVolume = 0;
  OnePole faderFilter, mixerVolFilter; double pwm = 0;
  int hatDecays = 0; double decayClosed = 0, decayOpen = 0; int isOpen = 0;
};

struct RouteState { int dest; float a[7]; float c[7]; bool on; double d; };

class LxrEngine {
 public:
  LxrEngine();
  void loadInitKit();
  void loadKit(const double* values, int n);
  void setParam(int par, double value);
  void setExtra(int n, int k, double value);
  void setTable(int n, const Wavetable* t);
  void setRouteAmt(int voice, int dest, int src, double amount);
  void setStepLen(int voice, double x);
  void setStep(int voice, int step, double level);
  void setStepTime(int voice, double t);
  void setStepSlew(int voice, double x);
  void trigger(int voice, int velocity, int note);
  /** the next 64 samples of each voice into out[0..5] */
  void renderBlock();

  Rng rng;
  double bpm = 120, stepBpm = 120;
  double faderVolume[6] = {1, 1, 1, 1, 1, 1};
  std::vector<double> activeParameters;
  int activeNrpnNumber = 0;
  float decimationRate[7], decimationCnt[6] = {};
  int16_t voiceSamples[6] = {};
  uint8_t audioRouting[6] = {};
  std::array<std::vector<RouteState>, 6> routes;
  std::array<std::vector<int>, 6> routeIndex;  // dest -> index in routes[v], -1
  float velLast[6] = {};
  float stepLevels[6 * NUM_STEPS] = {};
  float stepNow[6] = {}, stepTarget[6] = {}, stepCoef[6] = {};
  int8_t stepPlayed[6];
  uint8_t stepTime[6], stepLen[6];
  double stepClock[6] = {};
  Voice voices[6];
  int16_t out[6][BLOCK] = {};
  bool only[6] = {true, true, true, true, true, true};
  bool onlyAll = true;  // (this.only null: all six)

 private:
  int16_t bA[BLOCK], bB[BLOCK], bN[BLOCK], bC[BLOCK], bT[BLOCK], bM[BLOCK];
  Osc* toneWave(int par);
  void extraSet(int n, int k, double value);
  void dispatch(int par, double data2, bool isFloat, double v);
  void ccHandler(bool isCC2, int num, double data2, bool isFloat, double v);
  void modTo(int n, int dest, double d);
  void routeReset(int n, int dest);
  void routesFrom(int n, int src, double val);
  void modPos(int par, int kind, double d);
  void setOriginal(int par);
  void resetTargets();
  void lfoRetrigger(int voice);
  void lfoSetFreq(Lfo& lfo, double x);
  void stepRun(int n);
  void triggerOne(int n, int vel, int note, int open);
  void async(Voice& v);
  void sync(int n, int16_t* buf);
  void snareFinish(int n, Voice& v, int16_t* buf);
  void decimate(int n, int16_t* buf);
};

// ---- the echo: FxBus.c's delay (all wet), with the tempo sync ----
struct Delay {
  int mask; bool hasSync = false; double sync = 0; uint32_t oldRead = 0, newRead = 0; int write; double fracReadNew = 0, fracReadOld = 0;
  double interpValue = 0, interpStep = 0; int16_t tmp[2] = {}, tmp2[2] = {}; double feedback, range = 0;
  double delayTime = 0, pendingDelayTime = 0; int timePending = 0; OnePole tone, tone2; int type = 0;
};
class EchoBus {
 public:
  EchoBus();
  void setParameter(int idx, double value);
  void setDelaySync(double samples);
  void process(int16_t* out, int size);
  Delay delay;
  int16_t input[BLOCK * 2] = {};
 private:
  float parameter[4] = {};
  std::vector<float> buffer;
};

// ---- the reverb: FX/Reverb.c, with the stereo addition ----
struct VerbDelay { std::vector<float> buf; int readPtr = 0; double length = 256; int writePtr = 256; double roomSz = 1;
  bool mod = false; OnePole lp{}; double frac = 0, depth = 0, modVal = 0; };
struct Allpass { double g = 0.5, out = 0, in = 0; VerbDelay d; bool mod = false; };
struct Tilt { double a0 = 0, b1 = 0, lp = 0, lgain = 0, hgain = 0; };
class ReverbBus {
 public:
  ReverbBus();
  void setParameter(int idx, double v);
  void process(int16_t* out, int size);
  int16_t input[BLOCK * 2] = {};
  bool stereo = false;
 private:
  Tilt eq, eqFb, eqFbR;
  double lfoS[2] = {0.5, 0}, lfoA;
  double earlyVolume = 1, feedback = 0;
  OnePole lpFeedback, lpImpulse;
  double lastOut = 0, lastOut2 = 0;
  Allpass apDelay[2], apModDelay[2], inputAllpass[4];
  VerbDelay delay[4], early, preDelay;
  float parameter[4];
};

// (a one-pole: fmaf(r, in - b, b), with both roundings of the firmware's float)
double calcOnePole(OnePole& flt, double input);

}  // namespace lxr
