// engine/lxr.js, ported line by line. Each function keeps its JS name and its order of roundings: f() is Math.fround,
// everything else is double as in JS. See Js.h.
#include "LxrEngine.h"

#include <algorithm>
#include <cmath>
#include <cstring>

#include "../gen/LxrData.h"
#include "Js.h"

namespace lxr {
using namespace lxr::data;

namespace {

constexpr double PI = 3.141592653589793;
const double F_32767 = f(32767);
const double F_2POW32 = f(4294967295.0);

// ---- Oscillator.c ----
enum { SINE = 0, TRI = 1, SAW = 2, REC = 3, NOISE = 4, PWM = 5, NUM_OSC_WAVEFORMS = 6 };
constexpr int SEQ_DEFAULT_NOTE = 60;
const double SEMITONE_UP_MINUS_1 = f(f(1.0594630943592952645618252949463) - 1);

constexpr int TRI_LEN = (int)(sizeof(TRI_TABLE) / sizeof(TRI_TABLE[0]));
struct WaveMem {
  int16_t m[TRI_LEN * 3 + 1];
  WaveMem() {
    std::memcpy(m, TRI_TABLE, sizeof(TRI_TABLE));
    std::memcpy(m + TRI_LEN, REC_TABLE, sizeof(REC_TABLE));
    std::memcpy(m + TRI_LEN * 2, SAW_TABLE, sizeof(SAW_TABLE));
    m[TRI_LEN * 3] = SAW_TABLE[10 * 1024];
  }
};
const WaveMem WAVE_MEM_HOLDER;
const int16_t* const WAVE_MEM = WAVE_MEM_HOLDER.m;
constexpr int TRI_BASE = 0, REC_BASE = TRI_LEN, SAW_BASE = TRI_LEN * 2;

constexpr int WAVE_STEP = 25, FILTER_STEP = 18, MODE_MAX = 127;
const int WAVE_ORDER[6] = {SINE, TRI, SAW, REC, PWM, NOISE};
constexpr int WAVE_COUNT = 6;
constexpr int WAVE_MAX = WAVE_STEP * (WAVE_COUNT - 1);
int waveIndexOf(int raw) { for (int i = 0; i < WAVE_COUNT; i++) if (WAVE_ORDER[i] == raw) return i; return -1; }
double wavePos(int raw) { return raw < NUM_OSC_WAVEFORMS ? waveIndexOf(raw) * WAVE_STEP : 0; }
// (null as -1)
int waveRaw(double pos) { return std::fmod(pos, WAVE_STEP) == 0 && pos <= WAVE_MAX ? WAVE_ORDER[(int)(pos / WAVE_STEP)] : -1; }
double modePos(int raw) { return raw ? MODE_MAX : 0; }
int modeRaw(double pos) { return pos == 0 ? 0 : pos == MODE_MAX ? 1 : -1; }

void detent(double x, int step, int last, int& k, double& t) {
  const double r = jsRound(x);
  if (std::fabs(x - r) < 1e-3) x = r;
  const double p = jsMin(jsMax(x, 0) / step, last);
  k = (int)std::floor(p);
  t = k < last ? f(p - k) : 0;
}
void osc_setPos(Osc& osc, double x) {
  osc.wraw = x;
  if (osc.wtab) { const double p = x / WAVE_MAX; osc.wpos = p < 0 ? 0 : p > 1 ? 1 : p; osc.wB = -1; return; }
  int k; double t; detent(x, WAVE_STEP, WAVE_COUNT - 1, k, t);
  osc.waveform = WAVE_ORDER[k];
  if (t > 0) { osc.wB = WAVE_ORDER[k + 1]; osc.wt = t; } else osc.wB = -1;
}

inline uint32_t freq2PhaseIncr(double x) { return toU32(f(f(f(4096 * x) / REAL_FS) * 1048576)); }
inline uint32_t freq2PhaseIncr1024(double x) { return toU32(f(f(f(1024 * x) / REAL_FS) * 4194304)); }
inline uint32_t freq2PhaseIncr32767(double x) { return toU32(f(f(f(1024 * x) / REAL_FS) * 131072)); }

inline int clz32(uint32_t x) { if (!x) return 32; int n = 0; while (!(x & 0x80000000u)) { x <<= 1; n++; } return n; }
int freqToTableIndex(double fr) {
  const int log2 = (31 - clz32(toU32(f(fr / 440)))) & 0xff;
  const int midiNote = 12 * log2 + 70;
  return (midiNote / 12) & 0xff;
}

inline int lerp(const int16_t* mem, uint32_t idx, uint32_t frac, int shift) {
  const int a = mem[idx];
  const int d = mem[idx + 1] - a;
  return (int16_t)(uint16_t)(uint32_t)(int32_t)(a + (int64_t)std::floor((double)d * frac / (double)(1u << shift)));
}

void calcSineBlock(Osc& osc, int16_t* buf, int size, double gain) {
  const uint32_t* pm = osc.pm;
  for (int i = 0; i < size; i++) {
    const uint32_t phase = osc.phase, p = pm ? phase + pm[i] : phase;
    const int out = lerp(SINE_TABLE, p >> 20, p & 0xfffff, 20);
    osc.phase = phase + osc.phaseInc;
    buf[i] = (int16_t)toI16(f(out * gain));
  }
}
void calcFmSineBlock(Osc& osc, const int16_t* mod, int16_t* buf, int size, double gain) {
  const uint32_t* pm = osc.pm;
  for (int i = 0; i < size; i++) {
    const uint32_t phase = osc.phase;
    const uint32_t index = (pm ? phase + pm[i] : phase) + (toU32(f(mod[i] * osc.fmMod)) << 17);
    const int out = lerp(SINE_TABLE, index >> 20, index & 0xfffff, 20);
    osc.phase = phase + osc.phaseInc;
    buf[i] = (int16_t)toI16(f(out * gain));
  }
}
void calcFmBlock(Osc& osc, int base, const int16_t* mod, int16_t* buf, int size, double gain) {
  const int row = base + osc.tableOffset * 1024; const uint32_t* pm = osc.pm;
  for (int i = 0; i < size; i++) {
    const uint32_t phase = osc.phase;
    const uint32_t index = (pm ? phase + pm[i] : phase) + (toU32(f(mod[i] * osc.fmMod)) << 19);
    const int out = lerp(WAVE_MEM, row + (index >> 22), index & 0x3fffff, 22);
    osc.phase = phase + osc.phaseInc;
    osc.output = out;
    buf[i] = (int16_t)toI16(f(out * gain));
  }
}
inline uint32_t pwmShift(uint32_t phase, double pwm) { return toU32(f(f((double)phase) + f(pwm * 2147483648.0))); }
void calcPwmFmBlock(Osc& osc, const int16_t* mod, int16_t* buf, int size, double gain, double pwm) {
  const int row = SAW_BASE + osc.tableOffset * 1024; const uint32_t* pm = osc.pm;
  for (int i = 0; i < size; i++) {
    const uint32_t phase = osc.phase;
    const uint32_t index = (pm ? phase + pm[i] : phase) + (toU32(f(mod[i] * osc.fmMod)) << 19);
    const uint32_t index2 = pwmShift(index, pwm);
    const int a = lerp(WAVE_MEM, row + (index >> 22), index & 0x3fffff, 22);
    const int b = lerp(WAVE_MEM, row + (index2 >> 22), index2 & 0x3fffff, 22);
    const int out = qsub16(a, b);
    osc.phase = phase + osc.phaseInc;
    osc.output = out;
    buf[i] = (int16_t)toI16(f(out * gain));
  }
}
void calcWavetableOscBlock(Osc& osc, int base, int16_t* buf, int size, double gain) {
  const int row = base + osc.tableOffset * 1024; const uint32_t* pm = osc.pm;
  for (int i = 0; i < size; i++) {
    const uint32_t phase = osc.phase, p = pm ? phase + pm[i] : phase;
    const int out = lerp(WAVE_MEM, row + (p >> 22), p & 0x3fffff, 22);
    osc.phase = phase + osc.phaseInc;
    buf[i] = (int16_t)toI16(f(out * gain));
  }
}
void calcPwmBlock(Osc& osc, int16_t* buf, int size, double gain, double pwm) {
  const int row = SAW_BASE + osc.tableOffset * 1024; const uint32_t* pm = osc.pm;
  for (int i = 0; i < size; i++) {
    const uint32_t phase = osc.phase, p = pm ? phase + pm[i] : phase;
    const uint32_t phase2 = pwmShift(p, pwm);
    const int a = lerp(WAVE_MEM, row + (p >> 22), p & 0x3fffff, 22);
    const int b = lerp(WAVE_MEM, row + (phase2 >> 22), phase2 & 0x3fffff, 22);
    const int out = qsub16(a, b);
    osc.phase = phase + osc.phaseInc;
    osc.output = out;
    buf[i] = (int16_t)toI16(f(out * gain));
  }
}
void calcNoiseBlock(Osc& osc, int16_t* buf, int size, double gain, Rng& rng) {
  for (int i = 0; i < size; i++) {
    const uint32_t last = osc.phase;
    osc.phase = osc.phase + osc.phaseInc;
    if (last > osc.phase) osc.output = (int16_t)(uint16_t)rng.next();
    buf[i] = (int16_t)toI16(f(osc.output * gain));
  }
}
int waveAt(int w, uint32_t iS, uint32_t iT, int row, double pwm, const Osc& osc, double& noiseOut) {
  switch (w) {
    case SINE: return lerp(SINE_TABLE, iS >> 20, iS & 0xfffff, 20);
    case TRI: return lerp(WAVE_MEM, TRI_BASE + row + (iT >> 22), iT & 0x3fffff, 22);
    case SAW: return lerp(WAVE_MEM, SAW_BASE + row + (iT >> 22), iT & 0x3fffff, 22);
    case REC: return lerp(WAVE_MEM, REC_BASE + row + (iT >> 22), iT & 0x3fffff, 22);
    case PWM: {
      const uint32_t i2 = pwmShift(iT, pwm);
      return qsub16(lerp(WAVE_MEM, SAW_BASE + row + (iT >> 22), iT & 0x3fffff, 22), lerp(WAVE_MEM, SAW_BASE + row + (i2 >> 22), i2 & 0x3fffff, 22));
    }
    case NOISE: noiseOut = osc.output; return 0x7fffffff;
    default: return 0;
  }
}
// (waveAt for NOISE returns osc.output, which may be any number: kept as a double)
inline double waveAtD(int w, uint32_t iS, uint32_t iT, int row, double pwm, const Osc& osc) {
  double n = 0; const int r = waveAt(w, iS, iT, row, pwm, osc, n);
  return w == NOISE ? n : (double)r;
}
void calcBlendBlock(Osc& osc, const int16_t* mod, int16_t* buf, int size, double gain, double pwm, Rng& rng) {
  const uint32_t* pm = osc.pm; const int wA = osc.waveform, wB = osc.wB; const double t = osc.wt; const int row = osc.tableOffset * 1024;
  const bool noise = wA == NOISE || wB == NOISE;
  for (int i = 0; i < size; i++) {
    const uint32_t phase = osc.phase, p = pm ? phase + pm[i] : phase;
    uint32_t iS = p, iT = p;
    if (mod) { const uint32_t m = toU32(f(mod[i] * osc.fmMod)); iS = p + (m << 17); iT = p + (m << 19); }
    osc.phase = phase + osc.phaseInc;
    if (noise && phase > osc.phase) osc.output = (int16_t)(uint16_t)rng.next();
    const double a = waveAtD(wA, iS, iT, row, pwm, osc), b = waveAtD(wB, iS, iT, row, pwm, osc);
    buf[i] = (int16_t)toI16(f(f(a + f(f(b - a) * t)) * gain));
  }
}

constexpr double PHASE_ONE = 4294967296.0;
constexpr double LAG = PHASE_ONE * 3 / 4;
void calcWtBlock(Osc& osc, const int16_t* mod, int16_t* buf, int size, double gain) {
  const Wavetable& t = *osc.wtab; const uint32_t* pm = osc.pm; const double pos = osc.wpos, hz = osc.hz, g = f(gain * 32767);
  const double sine = mod && t.index == 0 ? jsMax(0, 1 - pos * (t.frames - 1) / 10) : 0;
  for (int i = 0; i < size; i++) {
    const uint32_t phase = osc.phase;
    const uint32_t p = jsU32((double)(pm ? phase + pm[i] : phase) + LAG);
    double out;
    if (mod) {
      const uint32_t m = toU32(f(mod[i] * osc.fmMod)), pT = p + (m << 19);
      out = readTable(t, pos, pT / PHASE_ONE, hz, REAL_FS);
      if (sine > 0) { const uint32_t pS = p + (m << 17); const double s = readTable(t, pos, pS / PHASE_ONE, hz, REAL_FS); out = s + (out - s) * (1 - sine); }
    } else out = readTable(t, pos, p / PHASE_ONE, hz, REAL_FS);
    osc.phase = phase + osc.phaseInc;
    osc.output = out * 32767;
    buf[i] = (int16_t)toI16(f(out * g));
  }
}

void calcNextOscSampleBlock(Osc& osc, int16_t* buf, int size, double gain, double pwm, Rng& rng) {
  if (osc.wtab) { calcWtBlock(osc, nullptr, buf, size, gain); return; }
  if (osc.wB >= 0) { calcBlendBlock(osc, nullptr, buf, size, gain, pwm, rng); return; }
  switch (osc.waveform) {
    case SINE: calcSineBlock(osc, buf, size, gain); break;
    case SAW: calcWavetableOscBlock(osc, SAW_BASE, buf, size, gain); break;
    case TRI: calcWavetableOscBlock(osc, TRI_BASE, buf, size, gain); break;
    case REC: calcWavetableOscBlock(osc, REC_BASE, buf, size, gain); break;
    case NOISE: calcNoiseBlock(osc, buf, size, gain, rng); break;
    case PWM: calcPwmBlock(osc, buf, size, gain, pwm); break;
    default: std::fill(buf, buf + size, 0); break;
  }
}
void calcNextOscSampleFmBlock(Osc& osc, const int16_t* mod, int16_t* buf, int size, double gain, double pwm, Rng& rng) {
  if (osc.wtab) { calcWtBlock(osc, mod, buf, size, gain); return; }
  if (osc.wB >= 0) { calcBlendBlock(osc, mod, buf, size, gain, pwm, rng); return; }
  switch (osc.waveform) {
    case SINE: calcFmSineBlock(osc, mod, buf, size, gain); break;
    case SAW: calcFmBlock(osc, SAW_BASE, mod, buf, size, gain); break;
    case TRI: calcFmBlock(osc, TRI_BASE, mod, buf, size, gain); break;
    case REC: calcFmBlock(osc, REC_BASE, mod, buf, size, gain); break;
    case NOISE: calcNoiseBlock(osc, buf, size, gain, rng); break;
    case PWM: calcPwmFmBlock(osc, mod, buf, size, gain, pwm); break;
    default: std::fill(buf, buf + size, 0); break;
  }
}

void osc_setFreq(Osc& osc) {
  const double cur = f(f(osc.freq * osc.pitchMod) * osc.modNodeValue);
  if (osc.wtab) { osc.hz = std::fabs(cur); osc.phaseInc = toU32(f(cur / REAL_FS) * PHASE_ONE); return; }
  if (osc.wB >= 0) {
    osc.phaseInc = freq2PhaseIncr1024(cur);
    const int idx = freqToTableIndex(cur);
    osc.tableOffset = idx > 10 ? 10 : idx;
    return;
  }
  switch (osc.waveform) {
    case SINE: case NOISE: osc.phaseInc = freq2PhaseIncr(cur); break;
    case SAW: case TRI: case REC: case PWM: {
      osc.phaseInc = freq2PhaseIncr1024(cur);
      const int idx = freqToTableIndex(cur);
      osc.tableOffset = idx > 10 ? 10 : idx;
      break;
    }
    default: osc.phaseInc = freq2PhaseIncr32767(cur); break;
  }
}
double calcDetune(double value) {
  const double frac = f(f(value / 127) - 0.5);
  return f(1 + f(frac * SEMITONE_UP_MINUS_1));
}
void osc_recalcFreq(Osc& osc) {
  const double cent = calcDetune((osc.midiFreq & 0xff) + osc.fineFrac);
  int note = (osc.midiFreq >> 8) + (osc.baseNote - SEQ_DEFAULT_NOTE);
  if (note > 127) note = 127;
  if (note < 0) note = 0;
  osc.freq = f(MIDI_NOTE_FREQ[note] * cent);
  if (osc.coarseFrac != 0 && note < 127) osc.freq = f(osc.freq * f(std::pow(2.0, osc.coarseFrac / 12)));
}
void osc_setBaseNote(Osc& osc, int baseNote) { osc.baseNote = baseNote & 0xff; osc_recalcFreq(osc); }
void setCoarse(Osc& osc, double v) { const double w = std::floor(v); osc.coarseFrac = v - w; osc.midiFreq = (osc.midiFreq & 0x00ff) | ((int)((uint32_t)jsI32(w) << 8) & 0xffff); osc_recalcFreq(osc); }
void setFine(Osc& osc, double v) { const double w = std::floor(v); osc.fineFrac = v - w; osc.midiFreq = (osc.midiFreq & 0xff00) | jsI32(w); osc_recalcFreq(osc); }

// ---- envelopes ----
inline double decaySlope(double val, double slope) { return f(f(f(1 + slope) * val) / f(1 + f(slope * std::fabs(val)))); }
const double TIME_K = f(f(2 * f(0.99)) / f(1 - f(0.99)));
double decayEg_calcTime(double data2) {
  const double val = f(data2 / 127);
  const double ret = f(f(1 - f(f(f(1 + TIME_K) * val) / f(1 + f(TIME_K * std::fabs(val))))) * 2);
  return ret > 1 ? 1 : ret;
}
void decayEg_setSlope(DecayEg& eg, double data2) {
  const double amount = f(f(f(data2 / 127) - 0.5) * 2);
  eg.slope = f(f(2 * amount) / f(1 - amount));
}
double decayEg_calc(DecayEg& eg) {
  double val = eg.value;
  if (val > 0) val = f(val - eg.decay); else val = 0;
  eg.value = val;
  return decaySlope(val, eg.slope);
}
enum { EG_STOPPED = 0, EG_A = 1, EG_D = 2, EG_REPEAT = 3 };
const double TIME_K_ATTACK = 2 * 0.99 / (1.0 - 0.99);
const double TIME_K_DECAY = 2 * 0.999 / (1.0 - 0.999);
inline double slopeValue(double val, double slope) { return (1.0 + slope) * val / (1.0 + slope * std::fabs(val)); }
double slopeEg2_calcTime(double data2, double amount) {
  const double val = data2 / 127.0;
  const double ret = f((1.0 - ((1.0 + amount) * val / (1.0 + amount * std::fabs(val)))) * 2);
  return ret > 1 ? 1 : ret;
}
void slopeEg2_setSlope(SlopeEg& eg, double data2) {
  const double amount = f(f(f(data2 / 127) - 0.5) * f(1.999));
  const double inv = -amount;
  eg.slope = 2 * amount / (1 - amount);
  eg.invSlope = 2 * inv / (1 - inv);
}
void slopeEg2_init(SlopeEg& eg) { eg.attack = 0.01; eg.decay = 0.01; eg.value = 0; eg.state = EG_STOPPED; eg.repeat = 0; slopeEg2_setSlope(eg, 0); }
void slopeEg2_trigger(SlopeEg& eg) {
  if (!eg.repeat) eg.state = EG_A; else { eg.state = EG_REPEAT; eg.value = 1.0; }
  eg.repeatCnt = eg.repeat;
}
double slopeEg2_calc(SlopeEg& eg) {
  double val = eg.value;
  switch (eg.state) {
    case EG_STOPPED: return 0.0;
    case EG_REPEAT:
      if (val > 0) val -= eg.attack;
      else {
        eg.repeatCnt = (eg.repeatCnt - 1) & 0xff;
        if (eg.repeatCnt > 0) val = 1.0; else { eg.state = EG_D; val = 1.0; }
      }
      eg.value = val;
      return slopeValue(val, eg.slope);
    case EG_A:
      val += eg.attack;
      if (val >= 1.0) { val = 1.0; eg.state = EG_D; }
      eg.value = val;
      return slopeValue(val, eg.invSlope);
    case EG_D:
      if (val > 0) { val -= eg.decay; eg.value = val; return slopeValue(val, eg.slope); }
      eg.value = 0;
      return 0;
  }
  return 0;
}
double snapEg_calc(double& value, double time) {
  double ret = 0;
  if (value > 0) { ret = f(f(value * value) * 24); value = f(value - f(f(0.2) * time)); }
  return ret;
}

// ---- transientGenerator.c ----
constexpr int NUM_TRANSIENTS = 12;
constexpr int TRANSIENT_LEN = 2205;
constexpr double TRANSIENT_END = 2311061504.0;
constexpr int NUM_WAVES = NUM_TRANSIENTS + 2 + NUM_EXTRA_CLICKS;
void transient_setWaveform(Transient& t, int w) { t.waveform = w < NUM_WAVES ? w : 0; }
void extra_calcBlock(Transient& t, int16_t* buf, int size) {
  const int16_t* d = EXTRA_CLICKS[t.waveform - NUM_TRANSIENTS - 2];
  const int end = EXTRA_CLICK_LEN[t.waveform - NUM_TRANSIENTS - 2] - 1;
  const double inc = t.pitch * 1048576;
  for (int i = 0; i < size; i++) {
    const double idx = t.phase / 1048576;
    if (idx < end) {
      const int k = jsI32(idx); const double fr = idx - k;
      buf[i] = (int16_t)toI16(t.volume * (d[k] + (d[k + 1] - d[k]) * fr));
      t.phase += inc;
    } else buf[i] = 0;
  }
}
void transient_calcBlock(Transient& t, int16_t* buf, int size) {
  if (t.waveform >= NUM_TRANSIENTS + 2) { extra_calcBlock(t, buf, size); return; }
  if (t.waveform <= 1 || t.phase >= TRANSIENT_END) { std::fill(buf, buf + size, 0); return; }
  const int base = (t.waveform - 2) * TRANSIENT_LEN;
  const double inc = f(t.pitch * 1048576);
  for (int i = 0; i < size; i++) {
    if (t.phase < TRANSIENT_END) {
      const uint32_t idx = jsU32(t.phase) >> 20;
      buf[i] = (int16_t)toI16(f(f(t.volume * (TRANSIENT_DATA[base + idx] * 256)) * (idx < TRANSIENT_LEN ? 1 : 0)));
      t.phase = toU32(f(f(t.phase) + inc));
    } else buf[i] = 0;
  }
}

// ---- distortion.c, 1PoleLp.c, valueShaper.h ----
inline double distShape(double shape) { shape = f(shape - 0.0078125); return f(f(2 * shape) / f(1 - shape)); }
inline int distortSample(double s, double shape) {
  double x = f(s / F_32767);
  x = f(f(f(1 + shape) * x) / f(1 + f(shape * std::fabs(x))));
  return toI16(f(x * 32767));
}
OnePole makeOnePole() { return OnePole{f(0.01), 0}; }
double valueShaperF2F(double val, double shape) {
  const double k = f(f(2 * shape) / f(f(1.0001) - shape));
  return f(f(f(1 + k) * val) / f(1 + f(k * std::fabs(val))));
}
const double FILTER_SHAPER = f(-0.9);

// ---- ResonantFilter.c ----
enum { FILTER_LP = 1, FILTER_HP = 2, FILTER_BP = 3, FILTER_UNITY_BP = 4, FILTER_NOTCH = 5, FILTER_PEAK = 6, FILTER_NAIVE_2_POLE = 7, FILTER_OFF = 8 };
inline double fastTanh(double v) {
  if (v < f(-1.95)) return -1;
  if (v > f(1.95)) return 1;
  return f(f(f(4.15) * v) / f(f(4.29) + f(v * v)));
}
inline double fastTan(double x) {
  x = f(x);
  const double x2 = f(x * x);
  const double A = f(f(-15 * x) + f(x * x2));
  const double B = f(3 * f(-5 + f(2 * x2)));
  return f(A / B);
}
inline double tanhXdX(double x) {
  const double a = f(x * x);
  return f(f(f(f(a + 105) * a) + 945) / f(f(f(f(15 * a) + 420) * a) + 945));
}
inline double softClipTwo(double x) { return f(x * tanhXdX(f(0.5 * x))); }
void SVF_directSetFilterValue(Filter& flt, double val) { flt.f = f(val * f(0.5 * f(0.9))); flt.g = fastTan(PI * flt.f); }
void SVF_init(Filter& flt) {
  flt.s1 = 0; flt.s2 = 0; flt.a = flt.b = 0; flt.ws1 = flt.ws2 = flt.wa = flt.wb = 0;
  flt.f = f(0.20); flt.q = f(0.9); flt.drive = f(0.315);
  SVF_directSetFilterValue(flt, f(0.25));
}
void SVF_reset(Filter& flt) { flt.s1 = 0; flt.s2 = 0; flt.a = flt.b = 0; flt.ws1 = flt.ws2 = flt.wa = flt.wb = 0; }
void SVF_setReso(Filter& flt, double fb) { flt.q = f(1 - fb); if (flt.q < f(0.1)) flt.q = f(0.02); }
void SVF_setDrive(Filter& flt, double d) { flt.drive = f(f(0.4) + f(f(d * d) * 6)); }
void SVF_recalcFreq(Filter& flt) { flt.g = fastTan(PI * flt.f); }

struct St { double s1, s2, a, b; };
inline void zdfStep(double& s1r, double& s2r, double x, double g, double gg, double R, double& y0o, double& y1o) {
  const double g0 = f(1 / f(1 + f(f(g * 2) * R)));
  const double s1 = s1r, s2 = s2r;
  const double f1 = f(gg * g0);
  const double y1 = f(f(f(f(f1 * x) + s2) + f(f(g * g0) * s1)) / f(f1 + 1));
  const double xx = f(x - y1);
  const double y0 = f(f(softClipTwo(s1) + f(g * xx)) * g0);
  s1r = f(softClipTwo(s1) + f(f(2 * g) * f(xx - f(f(2 * R) * y0))));
  s2r = f(s2 + f(f(2 * g) * y0));
  y0o = y0; y1o = y1;
}
inline void naiveStep(double& a, double& b, double x, double f2, double q) {
  a = f(a + f(f2 * f(f(x - a) + f(q * f(a - b)))));
  if (a > 1) a = 1; else if (a < -1) a = -1;
  b = f(b + f(f2 * f(a - b)));
  if (b > 1) b = 1; else if (b < -1) b = -1;
}
inline double naiveQ(const Filter& flt, double f2) { return f(f(1 - flt.q) * 1.4 + f(1 - flt.q) / (1.0 - f2)); }
void SVF_shadow(Filter& flt, const int16_t* buf, int size, bool zdf, bool naive) {
  const double g = flt.g, R = flt.f >= f(0.4499) ? 1 : flt.q, gg = f(g * g), f2 = f(flt.f * f(2.21)), q = naiveQ(flt, f2);
  St st{flt.ws1, flt.ws2, flt.wa, flt.wb};
  if (st.s1 != st.s1) st.s1 = 0;
  if (st.s2 != st.s2) st.s2 = 0;
  double y0, y1;
  for (int i = 0; i < size; i++) {
    const double x = softClipTwo(f(f(buf[i] / F_32767) * flt.drive));
    if (zdf) zdfStep(st.s1, st.s2, x, g, gg, R, y0, y1);
    if (naive) naiveStep(st.a, st.b, x, f2, q);
  }
  flt.ws1 = st.s1; flt.ws2 = st.s2; flt.wa = st.a; flt.wb = st.b;
}
void SVF_calcBlockZDF(Filter& flt, int type, int16_t* buf, int size) {
  const double g = flt.g;
  const double R = flt.f >= f(0.4499) ? 1 : flt.q;
  const double gg = f(g * g);
  if (type == FILTER_OFF) { SVF_shadow(flt, buf, size, true, true); return; }
  if (type == FILTER_NAIVE_2_POLE) SVF_shadow(flt, buf, size, true, false);
  else if (type >= FILTER_LP && type <= FILTER_PEAK) SVF_shadow(flt, buf, size, false, true);
  if (type == FILTER_NAIVE_2_POLE) {
    const double f2 = f(flt.f * f(2.21));
    for (int i = 0; i < size; i++) {
      const double x = softClipTwo(f(f(buf[i] / F_32767) * flt.drive));
      const double q = f(f(1 - flt.q) * 1.4 + f(1 - flt.q) / (1.0 - f2));
      flt.a = f(flt.a + f(f2 * f(f(x - flt.a) + f(q * f(flt.a - flt.b)))));
      if (flt.a > 1) flt.a = 1; else if (flt.a < -1) flt.a = -1;
      flt.b = f(flt.b + f(f2 * f(flt.a - flt.b)));
      if (flt.b > 1) flt.b = 1; else if (flt.b < -1) flt.b = -1;
      buf[i] = (int16_t)ssat16(toI32(f(flt.b * 32767)));
    }
    return;
  }
  if (flt.s1 != flt.s1) flt.s1 = 0;
  if (flt.s2 != flt.s2) flt.s2 = 0;
  for (int i = 0; i < size; i++) {
    const double x = softClipTwo(f(f(buf[i] / F_32767) * flt.drive));
    const double g0 = f(1 / f(1 + f(f(g * 2) * R)));
    const double s1 = flt.s1, s2 = flt.s2;
    const double f1 = f(gg * g0);
    const double y1 = f(f(f(f(f1 * x) + s2) + f(f(g * g0) * s1)) / f(f1 + 1));
    const double xx = f(x - y1);
    const double y0 = f(f(softClipTwo(s1) + f(g * xx)) * g0);
    flt.s1 = f(softClipTwo(s1) + f(f(2 * g) * f(xx - f(f(2 * R) * y0))));
    flt.s2 = f(s2 + f(f(2 * g) * y0));
    double out;
    switch (type) {
      case FILTER_LP: out = f(fastTanh(y1) * 32767); break;
      case FILTER_HP: { const double ugb = f(f(2 * R) * y0); out = f(f(f(x - ugb) - y1) * 32767); break; }
      case FILTER_BP: out = f(y0 * 32767); break;
      case FILTER_UNITY_BP: out = f(f(f(2 * R) * y0) * 32767); break;
      case FILTER_NOTCH: out = f(f(x - f(f(2 * R) * y0)) * 32767); break;
      case FILTER_PEAK: { const double ugb = f(f(2 * R) * y0); const double h = f(f(x - ugb) - y1); out = f(f(y1 - h) * 32767); break; }
      default: return;
    }
    buf[i] = (int16_t)ssat16(toI32(out));
  }
}

const int FILTER_ORDER[8] = {FILTER_LP, FILTER_BP, FILTER_UNITY_BP, FILTER_HP, FILTER_NOTCH, FILTER_PEAK, FILTER_NAIVE_2_POLE, FILTER_OFF};
constexpr int FILTER_COUNT = 8;
constexpr int FILTER_MAX = FILTER_STEP * (FILTER_COUNT - 1);
int filterIndexOf(int t) { for (int i = 0; i < FILTER_COUNT; i++) if (FILTER_ORDER[i] == t) return i; return -1; }
double filterPos(int raw) { return filterIndexOf(std::min(raw + 1, (int)FILTER_OFF)) * FILTER_STEP; }
int filterRaw(double pos) { return std::fmod(pos, FILTER_STEP) == 0 && pos <= FILTER_MAX ? FILTER_ORDER[(int)(pos / FILTER_STEP)] - 1 : -999; }
const double FW[9][7] = {
  {0, 0, 0, 0, 0, 0, 0},
  {1, 0, 0, 0, 0, 0, 0},    // LP
  {0, -1, 0, -1, 1, 0, 0},  // HP
  {0, 0, 1, 0, 0, 0, 0},    // BP
  {0, 0, 0, 1, 0, 0, 0},    // UNITY BP
  {0, 0, 0, -1, 1, 0, 0},   // NOTCH
  {0, 2, 0, 1, -1, 0, 0},   // PEAK
  {0, 0, 0, 0, 0, 1, 0},    // LP2
  {0, 0, 0, 0, 0, 0, 1},    // OFF
};

// ---- the TYPE dial's curve (filterWarp), from the filter's response (filterResponseAt) ----
constexpr int WARP_N = 32;
std::vector<double> filterResponseAt(double cut, double reso, int k, double t, const std::vector<double>& hz) {
  const double fn = jsMax(1e-5, valueShaperF2F(jsMin(jsMax(cut / 127, 0), 1), FILTER_SHAPER) * f(0.5 * f(0.9)));
  double q = 1 - jsMin(jsMax(reso / 127, 0), 1); if (q < 0.1) q = 0.02;
  const double R = fn >= 0.4499 ? 1 : q, g = fastTan(PI * fn);
  const double* A = FW[FILTER_ORDER[k]]; const double* B = t > 0 ? FW[FILTER_ORDER[k + 1]] : A;
  double w[7]; for (int i = 0; i < 7; i++) w[i] = A[i] + (B[i] - A[i]) * t;
  const double wl = w[0] + w[1], wb = w[2] + 2 * R * w[3], wx = w[4] + w[6];
  const double f2 = fn * 2.21, q2 = (1 - q) * 1.4 + (1 - q) / (1 - f2), c1 = 1 - f2 + f2 * q2, c2 = 1 - f2;
  std::vector<double> o; o.reserve(hz.size());
  for (double h : hz) {
    const double om = 2 * PI * jsMin(h, REAL_FS * 0.4999) / REAL_FS, si = std::tan(om / 2) / g;
    const double dr = 1 - si * si, di = 2 * R * si, dd = dr * dr + di * di;
    double re = wx + (wl * dr + wb * si * di) / dd, im = (-wl * di + wb * si * dr) / dd;
    if (w[5] != 0) {
      const double zr = std::cos(om), zi = -std::sin(om);
      const double pr = 1 - c1 * zr, pi = -c1 * zi, qr = 1 - c2 * zr, qi = -c2 * zi;
      const double nr = pr * qr - pi * qi + f2 * f2 * q2 * zr, ni = pr * qi + pi * qr + f2 * f2 * q2 * zi, nn = nr * nr + ni * ni;
      re += w[5] * f2 * f2 * nr / nn; im -= w[5] * f2 * f2 * ni / nn;
    }
    o.push_back(std::hypot(re, im));
  }
  return o;
}
struct Warps {
  double c[FILTER_COUNT - 1][WARP_N + 1];
  Warps() {
    std::vector<double> hz(48); for (int i = 0; i < 48; i++) hz[i] = 20 * std::pow(1000.0, i / 47.0);
    const double at[3][2] = {{40, 20}, {64, 40}, {90, 90}};
    for (int j = 0; j < FILTER_COUNT - 1; j++) {
      auto db = [&](double t) {
        std::vector<std::vector<double>> r;
        for (auto& cr : at) { auto x = filterResponseAt(cr[0], cr[1], j, t, hz); for (auto& v : x) v = jsMax(-40, 20 * std::log10(v + 1e-9)); r.push_back(x); }
        return r;
      };
      std::vector<double> d; auto prev = db(0);
      for (int i = 1; i <= WARP_N; i++) {
        auto now = db((double)i / WARP_N); double s = 0;
        for (size_t a = 0; a < now.size(); a++) for (size_t b = 0; b < now[a].size(); b++) s += std::fabs(now[a][b] - prev[a][b]);
        d.push_back(s); prev = now;
      }
      double sum = 0; for (double x : d) sum += x;
      const double mean = sum / d.size();
      c[j][0] = 0; for (int i = 0; i < WARP_N; i++) c[j][i + 1] = c[j][i] + d[i] + 0.1 * mean;
      const double last = c[j][WARP_N];
      for (int i = 0; i <= WARP_N; i++) c[j][i] = c[j][i] / last;
    }
  }
};
const Warps& warps() { static const Warps w; return w; }
double filterWarp(int k, double u) {
  if (u <= 0 || u >= 1) return u;
  const double* c = warps().c[k]; int i = 1;
  while (i < WARP_N && c[i] < u) i++;
  return (i - 1 + (u - c[i - 1]) / (c[i] - c[i - 1])) / WARP_N;
}

void voice_setFilterPos(Voice& v, double x) {
  int k; double u; detent(x, FILTER_STEP, FILTER_COUNT - 1, k, u);
  const double t = filterWarp(k, u);
  v.filterType = FILTER_ORDER[k];
  if (t > 0) { v.filterB = FILTER_ORDER[k + 1]; v.filterT = t; } else v.filterB = 0;
  const double* A = FW[v.filterType]; const double* B = t > 0 ? FW[v.filterB] : A;
  const bool first = !v.fw;
  v.fw = true;
  for (int i = 0; i < 7; i++) v.fwTo[i] = A[i] + (B[i] - A[i]) * t;
  if (first) std::memcpy(v.fwAt, v.fwTo, sizeof(v.fwTo));
}
void SVF_calcBlockMorph(Filter& flt, const double* from, const double* to, int entering, int16_t* buf, int size) {
  const double g = flt.g, R = flt.f >= f(0.4499) ? 1 : flt.q, gg = f(g * g);
  const double f2 = f(flt.f * f(2.21)), q = naiveQ(flt, f2);
  if (entering == FILTER_NAIVE_2_POLE) { flt.s1 = flt.ws1; flt.s2 = flt.ws2; }
  else if (entering == FILTER_OFF) { flt.s1 = flt.ws1; flt.s2 = flt.ws2; flt.a = flt.wa; flt.b = flt.wb; }
  else if (entering) { flt.a = flt.wa; flt.b = flt.wb; }
  if (flt.s1 != flt.s1) flt.s1 = 0;
  if (flt.s2 != flt.s2) flt.s2 = 0;
  const double R2 = 2 * R;
  for (int i = 0; i < size; i++) {
    const double u = (double)(i + 1) / size;
    auto w = [&](int j) { return from[j] + (to[j] - from[j]) * u; };
    const double dry = buf[i], x = softClipTwo(f(f(dry / F_32767) * flt.drive));
    double y0, y1;
    zdfStep(flt.s1, flt.s2, x, g, gg, R, y0, y1);
    naiveStep(flt.a, flt.b, x, f2, q);
    const double sum = w(0) * fastTanh(y1) + w(1) * y1 + w(2) * y0 + w(3) * R2 * y0 + w(4) * x + w(5) * flt.b;
    buf[i] = (int16_t)ssat16(toI32(sum * 32767 + w(6) * dry));
  }
  flt.ws1 = flt.s1; flt.ws2 = flt.s2; flt.wa = flt.a; flt.wb = flt.b;
}
const double FILTER_GLIDE = 1 - std::exp(-BLOCK / (90.0 / 1000 * REAL_FS));
void filterBlock(Voice& v, int16_t* buf) {
  bool same = true; for (int i = 0; i < 7; i++) if (v.fwAt[i] != v.fwTo[i]) same = false;
  if (!v.fw || (!v.filterB && same)) { SVF_calcBlockZDF(v.filter, v.filterType, buf, BLOCK); v.fFirm = v.filterType; return; }
  double next[7]; bool near = true;
  for (int i = 0; i < 7; i++) { const double d = v.fwTo[i] - v.fwAt[i]; next[i] = v.fwAt[i] + d * FILTER_GLIDE; if (std::fabs(d) > 2e-3) near = false; }
  if (near) std::memcpy(next, v.fwTo, sizeof(next));
  SVF_calcBlockMorph(v.filter, v.fwAt, next, v.fFirm, buf, BLOCK);
  std::memcpy(v.fwAt, next, sizeof(next));
  v.fFirm = 0;
}

// ---- lfo.c ----
constexpr int NUM_LFO_WAVEFORMS = 8;
const double LFO_SR = f(REAL_FS / f(BLOCK));
constexpr double LFO_MAX_F = 200;
double lfo_calc(Lfo& lfo, Rng& rng) {
  const uint32_t old = lfo.phase;
  lfo.phase = lfo.phase + toU32(f(lfo.phaseInc * lfo.modNodeValue));
  const bool overflow = old > lfo.phase;
  const uint32_t ph = lfo.phase;
  switch (lfo.waveform) {
    case 0: return f(f(f(SINE_TABLE[ph >> 20] / F_32767) + 1) / 2);
    case 1: return f(1 - std::fabs(f(f(f(f((double)ph) / F_2POW32) * 2) - 1)));
    case 2: return f(f((double)ph) / F_2POW32);
    case 4: return ph > 0x7fffffffu ? 1 : 0;
    case 5:
      if (overflow) { lfo.rnd = f((double)rng.next()); lfo.rnd = f(lfo.rnd / F_2POW32); }
      return lfo.rnd;
    case 3: return f(f((double)(0xffffffffu - ph)) / F_2POW32);
    case 6: { const double x = f(f((double)ph) / F_2POW32); return f(f(x * x) * x); }
    case 7: { const double x = f(f((double)(0xffffffffu - ph)) / F_2POW32); return f(f(x * x) * x); }
    default: return 0;
  }
}
const double SYNC_SCALERS[12] = {0, 0.25, 0.5, 1, 2, 3, 4, 6, 8, 12, 16, 32};
double lfo_calcPhaseInc(double freq, int sync, double bpm) {
  if (sync == 0 || sync > 11) return toU32(f(f(freq / LFO_SR) * F_2POW32));
  const double b = f(bpm);
  const double tempo = b > 0.0 ? f(f(b / 60) / 4) : 0;
  const double syncFreq = f(tempo * SYNC_SCALERS[sync]);
  return toU32(f(f(syncFreq / LFO_SR) * F_2POW32));
}

const double STEP_BEATS[7] = {1.0 / 16, 1.0 / 8, 1.0 / 4, 1.0 / 2, 1, 2, 4};
constexpr int STEP_TIMES_LEN = 7, STEP_TIME_DEF = 2;
inline double slewMs(double x) { return x > 0 ? jsRound(2000 * std::pow(x / 127, 2) + 2) : 0; }

// ---- voices ----
enum { EX_KIND = 0, EX_PITCH_DECAY, EX_PITCH_SLOPE, EX_PITCH_AMOUNT, EX_A_FREQ, EX_A_GAIN, EX_A_WAVE, EX_A_MODE, EX_B_FREQ, EX_B_GAIN,
  EX_B_WAVE, EX_NOISE_COLOUR, EX_NOISE_MIX, EX_FM_ENV, EX_ROUTE_TONE, EX_ROUTE_NOISE, EX_ROUTE_CLICK, EX_REPEAT, NUM_EX };
static_assert(NUM_EX == NUM_EXTRAS, "the extras changed in engine/lxr.js: port them");
const int VOICE_KINDS[6] = {KIND_DRUM, KIND_DRUM, KIND_DRUM, KIND_SNARE, KIND_CYM, KIND_HAT};
struct Has { int A, B, N, P; };
const Has HAS[4] = {{1, 0, 0, 1}, {0, 0, 1, 1}, {1, 1, 0, 0}, {1, 1, 0, 0}};
void extraDefaults(int kind, double* d) {
  for (int i = 0; i < NUM_EX; i++) d[i] = 0;
  d[EX_KIND] = kind;
  d[EX_PITCH_DECAY] = 20; d[EX_PITCH_SLOPE] = 0; d[EX_PITCH_AMOUNT] = 0;
  d[EX_A_FREQ] = 60; d[EX_A_GAIN] = 0; d[EX_A_WAVE] = 0; d[EX_A_MODE] = 0;
  d[EX_B_FREQ] = 60; d[EX_B_GAIN] = 0; d[EX_B_WAVE] = 0;
  d[EX_NOISE_COLOUR] = 127; d[EX_NOISE_MIX] = 0;
  d[EX_FM_ENV] = kind == KIND_DRUM || kind == KIND_SNARE ? 127 : 0;
  d[EX_ROUTE_TONE] = kind == KIND_SNARE ? 0 : 1; d[EX_ROUTE_NOISE] = 1; d[EX_ROUTE_CLICK] = kind == KIND_DRUM ? 1 : 0;
  d[EX_REPEAT] = 0;
}
const double MIXER_R0 = f(0.01), DRIVE_R0 = f(0.01);
void setOsc(Osc& o, double freq, int waveform, double fmMod, int midiFreq, double pitchMod, double modNodeValue) {
  o.freq = freq; o.waveform = waveform; o.fmMod = fmMod; o.midiFreq = midiFreq; o.pitchMod = pitchMod; o.modNodeValue = modNodeValue;
}
void makeVoice(Voice& v, int kind, int i) {
  v = Voice{};
  v.kind = kind;
  extraDefaults(kind, v.extra);
  v.vol = f(0.8);
  v.oscPitchEg = DecayEg{f(0.01), 0, 0}; v.egPitchModAmount = f(0.5);
  v.driveFilter = makeOnePole(); v.faderFilter = makeOnePole(); v.mixerVolFilter = makeOnePole();
  v.distShape = distShape(0);
  for (Osc* o : {&v.modOsc, &v.modOsc2, &v.noiseOsc}) { o->freq = 440; o->midiFreq = 70 << 8 | 64; o->pitchMod = 1; o->modNodeValue = 1; }
  v.noiseOsc.waveform = NOISE;
  if (kind == KIND_DRUM) {
    v.srcA = 1; v.pitchEg = 1; v.fmEnv = 1; v.mixAmt = 1; v.filterType = 1; v.fmModAmount = f(0.5);
    v.faderFilter.r = 0.01; v.mixerVolFilter.r = 0.01; v.driveFilter.r = 0.01;
    setOsc(v.modOsc, 440, 1, 0, 70 << 8 | 64, 1, 1);
    v.osc.freq = 440; v.osc.modNodeValue = 1; v.osc.waveform = TRI + i; v.osc.fmMod = 0; v.osc.midiFreq = 70 << 8 | 64;
  } else if (kind == KIND_SNARE) {
    v.srcN = 1; v.pitchEg = 1; v.fmEnv = 1; v.routeT = 0; v.routeC = 0;
    v.faderFilter.r = 0.1;
    setOsc(v.noiseOsc, 440, 1, 0, 70 << 8 | 64, 1, 1);
    v.osc.freq = 440; v.osc.waveform = 1; v.osc.fmMod = 0; v.osc.midiFreq = 70 << 8 | 64; v.osc.modNodeValue = 1;
  } else {
    v.srcA = 1; v.srcB = 1; v.routeC = 0; v.carrierGain = kind == KIND_HAT ? f(0.5) : 1; v.egPitchModAmount = 0;
    v.fmModAmount = f(0.5); v.fmModAmount2 = f(0.5);
    v.faderFilter.r = 0.1;
    setOsc(v.modOsc, 440, SINE, 0, 70 << 8 | 64, 1, 1);
    setOsc(v.modOsc2, 440, NOISE, 0, 70 << 8 | 64, 1, 1);
    setOsc(v.osc, 440, 1, 1, 70 << 8 | 64, 1, 1);
  }
  v.hatDecays = i == 5 ? 1 : 0;
  slopeEg2_init(v.oscVolEg);
  SVF_init(v.filter);
}
void voiceParts(Voice& v) {
  const Has& h = HAS[v.kind];
  v.srcA = h.A || v.fmModAmount > 0 ? 1 : 0;
  v.srcB = h.B || v.fmModAmount2 > 0 ? 1 : 0;
  v.srcN = h.N || v.mix > 0 ? 1 : 0;
  v.pitchEg = h.P || v.egPitchModAmount > 0 ? 1 : 0;
}
void updatePan(Voice& v) {
  v.triggeredPanL = f(std::sqrt(f((127 - v.pan) / 127)));
  v.triggeredPanR = f(std::sqrt(f(v.pan / 127)));
}
inline double drumSineStart(double offset) { return f(1024 + f(((double)(0x3ff << 20) - 1024) * offset)); }
inline double otherSineStart(double offset) { return f((double)(0x3ff << 20) * offset); }
void resetPhase(Osc& osc, double offset, bool drum) {
  if (osc.wtab) { osc.phase = toU32(f((double)(0xff << 22) * offset)); return; }
  const int w = osc.wB >= 0 && osc.wt >= 0.5 ? osc.wB : osc.waveform;
  if (w == SINE) osc.phase = toU32(drum ? drumSineStart(offset) : otherSineStart(offset));
  else if (w > SINE && w <= REC) osc.phase = toU32(f((double)(0xff << 22) * offset));
  else osc.phase = 0;
}

}  // namespace

double calcOnePole(OnePole& flt, double input) {
  flt.b = (double)std::fmaf((float)flt.r, (float)(input - flt.b), (float)flt.b);
  return flt.b;
}

// =====================================================================================================================
// The engine
// =====================================================================================================================
LxrEngine::LxrEngine() : rng(0x12345678), activeParameters(PAR_NUM_PARAMS_ARRAY, 0.0) {
  for (auto& d : decimationRate) d = 1;
  for (auto& s : stepPlayed) s = -1;
  for (auto& s : stepTime) s = STEP_TIME_DEF;
  for (auto& s : stepLen) s = 8;
  for (int i = 0; i < 6; i++) makeVoice(voices[i], VOICE_KINDS[i], i);
  for (auto& ix : routeIndex) ix.assign(EXTRA_DEST + NUM_EX + 1, -1);
}

Osc* LxrEngine::toneWave(int par) {
  if (par == PAR_OSC_WAVE_DRUM1) return &voices[0].osc;
  if (par == PAR_OSC_WAVE_DRUM2) return &voices[1].osc;
  if (par == PAR_OSC_WAVE_DRUM3) return &voices[2].osc;
  if (par == PAR_OSC_WAVE_SNARE) return &voices[3].osc;
  if (par == PAR_WAVE1_CYM) return &voices[4].osc;
  if (par == PAR_WAVE1_HH) return &voices[5].osc;
  return nullptr;
}

void LxrEngine::loadInitKit() {
  std::vector<double> kit(END_OF_SOUND_PARAMETERS, 0.0);
  for (int i = 8; i < END_OF_SOUND_PARAMETERS; i++) kit[i - 8] = INIT_KIT[i];
  // kitToPositions
  for (int p = 0; p < END_OF_SOUND_PARAMETERS && p < 256; p++) {
    const int raw = (int)kit[p];
    switch (POS_KIND[p]) {
      case 1: kit[p] = st8(wavePos(raw)); break;
      case 2: kit[p] = st8(filterPos(raw)); break;
      case 3: kit[p] = st8(modePos(raw)); break;
      default: break;
    }
  }
  loadKit(kit.data(), (int)kit.size());
}

void LxrEngine::loadKit(const double* values, int n) {
  for (int i = 0; i < n && i < END_OF_SOUND_PARAMETERS; i++) activeParameters[i] = values[i];
  for (int i = 0; i < END_OF_SOUND_PARAMETERS; i++) {
    const int p = PARAMETER_ORDER[i];
    if (p == PAR_NRPN_DATA_ENTRY_COARSE || p == PAR_NRPN_FINE || p == PAR_NRPN_COARSE) continue;
    setParam(p, activeParameters[p]);
  }
}

void LxrEngine::setExtra(int n, int k, double value) { voices[n].extra[k] = value; extraSet(n, k, value); }

void LxrEngine::setTable(int n, const Wavetable* t) {
  Osc& osc = voices[n].osc;
  if (osc.wtab == t) return;
  osc.wtab = t;
  osc_setPos(osc, osc.wraw);
  osc_setFreq(osc);
}

void LxrEngine::extraSet(int n, int k, double value) {
  Voice& v = voices[n]; const double flt = f(value / 127);
  switch (k) {
    case EX_KIND: {
      const int kk = jsI32(jsRound(value));
      v.kind = kk >= 0 && kk < 4 && jsRound(value) == kk ? kk : KIND_DRUM;
      v.carrierGain = v.kind == KIND_HAT ? f(0.5) : 1;
      const bool d = v.kind == KIND_DRUM;
      if (!HAS[v.kind].P) v.osc.pitchMod = 1;
      v.faderFilter.r = d ? 0.01 : 0.1; v.mixerVolFilter.r = d ? 0.01 : MIXER_R0; v.driveFilter.r = d ? 0.01 : DRIVE_R0;
      break;
    }
    case EX_PITCH_DECAY: v.oscPitchEg.decay = decayEg_calcTime(value); break;
    case EX_PITCH_SLOPE: decayEg_setSlope(v.oscPitchEg, value); break;
    case EX_PITCH_AMOUNT: v.egPitchModAmount = f(f(flt * flt) * 32); break;
    case EX_A_FREQ: setCoarse(v.modOsc, value); break;
    case EX_A_GAIN: v.fmModAmount = flt; break;
    case EX_A_WAVE: osc_setPos(v.modOsc, value); break;
    case EX_A_MODE: v.mixAmt = flt; break;
    case EX_B_FREQ: setCoarse(v.modOsc2, value); break;
    case EX_B_GAIN: v.fmModAmount2 = flt; break;
    case EX_B_WAVE: osc_setPos(v.modOsc2, value); break;
    case EX_NOISE_COLOUR: v.noiseOsc.freq = f(flt * 22000); break;
    case EX_NOISE_MIX: v.mix = flt; break;
    case EX_FM_ENV: v.fmEnv = flt; break;
    case EX_ROUTE_TONE: v.routeT = value >= 0.5 ? 1 : 0; break;
    case EX_ROUTE_NOISE: v.routeN = value >= 0.5 ? 1 : 0; break;
    case EX_ROUTE_CLICK: v.routeC = value >= 0.5 ? 1 : 0; break;
    case EX_REPEAT: v.oscVolEg.repeat = (int)jsRound(value); break;
    default: break;
  }
}

void LxrEngine::setParam(int par, double value) {
  activeParameters[par] = value;
  if (par == 0) return;
  dispatch(par, value, false, 0);
}
void LxrEngine::dispatch(int par, double data2, bool isFloat, double v) {
  if (par < 128) ccHandler(false, (par + 1) & 0x7f, data2, isFloat, v);
  else ccHandler(true, (par - 128) & 0x7f, data2, isFloat, v);
}

void LxrEngine::setRouteAmt(int voice, int dest, int src, double amount) {
  auto& m = routes[voice]; auto& ix = routeIndex[voice];
  if (dest < 0 || dest >= (int)ix.size()) return;
  if (ix[dest] < 0) { RouteState r{}; r.dest = dest; ix[dest] = (int)m.size(); m.push_back(r); }
  RouteState& r = m[ix[dest]];
  if ((double)r.a[src] == f(amount)) return;
  r.a[src] = (float)amount;
  bool on = false; for (float x : r.a) if (x != 0) on = true;
  if (r.on && !on) { routeReset(voice, dest); for (auto& c : r.c) c = 0; r.d = 0; }
  r.on = on;
}
void LxrEngine::setStepLen(int voice, double x) {
  stepLen[voice] = (uint8_t)jsMax(1, jsMin(NUM_STEPS, jsRound(x)));
  if (stepPlayed[voice] >= stepLen[voice]) stepPlayed[voice] = 0;
}
void LxrEngine::setStep(int voice, int step, double level) { stepLevels[voice * NUM_STEPS + step] = (float)f(level); }
void LxrEngine::setStepTime(int voice, double t) { stepTime[voice] = st8(jsMax(0, jsMin(STEP_TIMES_LEN - 1, jsRound(t)))); }
void LxrEngine::setStepSlew(int voice, double x) { const double ms = slewMs(x); stepCoef[voice] = ms != 0 ? (float)f(std::exp(-BLOCK / (ms / 1000 * REAL_FS))) : 0; }
void LxrEngine::stepRun(int n) {
  if (stepPlayed[n] >= 0) {
    const double len = STEP_BEATS[stepTime[n]] * 60 / stepBpm * REAL_FS;
    stepClock[n] += BLOCK;
    while (stepClock[n] >= len) { stepClock[n] -= len; stepPlayed[n] = (int8_t)((stepPlayed[n] + 1) % stepLen[n]); }
  }
  const int k = stepPlayed[n];
  if (k >= 0) stepTarget[n] = stepLevels[n * NUM_STEPS + k];
  const double c = stepCoef[n], t = stepTarget[n];
  stepNow[n] = (float)(c != 0 ? f(t + f(f(stepNow[n] - t) * c)) : t);
}

void LxrEngine::trigger(int voice, int velocity, int note) {
  if (voice < 6) triggerOne(voice, velocity, note, 0);
  else triggerOne(5, velocity, note, 1);
}

void LxrEngine::modTo(int n, int dest, double d) {
  if (dest >= EXTRA_DEST) {
    const int k = dest - EXTRA_DEST; const double x = f(f(voices[n].extra[k] / 127) + d);
    extraSet(n, k, (x < 0 ? 0 : x > 1 ? 1 : x) * 127);
    return;
  }
  if (dest < 0 || dest >= 256 || !MODULATABLE[dest]) return;
  const int kind = POS_KIND[dest];
  if (kind) { modPos(dest, kind, d); return; }
  const double original = f(activeParameters[dest] / 127);
  double nv = f(original + d);
  nv = nv < 0 ? 0 : nv > 1 ? 1 : nv;
  dispatch(dest, 0, true, nv);
}
void LxrEngine::routeReset(int n, int dest) {
  if (dest >= EXTRA_DEST) { const int k = dest - EXTRA_DEST; extraSet(n, k, voices[n].extra[k]); return; }
  setOriginal(dest);
}
void LxrEngine::routesFrom(int n, int src, double val) {
  for (auto& r : routes[n]) {
    const double a = r.a[src]; if (a == 0) continue;
    r.c[src] = (float)(src <= SRC_VEL ? f(a * f(f(val * 2) - 1)) : f(a * val));
    double d = r.c[SRC_LFO]; for (int s = SRC_VEL; s <= SRC_MACRO; s++) d = f(d + r.c[s]);
    r.d = d; modTo(n, r.dest, d);
  }
}
void LxrEngine::modPos(int par, int kind, double d) {
  const double base = activeParameters[par];
  Osc* tw = kind == 1 ? toneWave(par) : nullptr;
  const bool wt = tw && tw->wtab;
  int raw; bool isNull;
  if (wt) { isNull = true; raw = 0; }
  else if (kind == 1) { raw = waveRaw(base); isNull = raw < 0; }
  else if (kind == 2) { raw = filterRaw(base); isNull = raw == -999; }
  else { raw = modeRaw(base); isNull = raw < 0; }
  auto clamp = [](double x) { return x < 0 ? 0 : x > 1 ? 1 : x; };
  double x;
  if (isNull) x = f(clamp(f(f(base / 127) + d)) * 127);
  else {
    const double nv = clamp(f(f(raw / 127.0) + d));
    if (kind == 1) { const int w = toU8(f(NUM_OSC_WAVEFORMS * nv)); x = wavePos(w >= NUM_OSC_WAVEFORMS ? NUM_OSC_WAVEFORMS - 1 : w); }
    else if (kind == 2) { const int t = toU8(f(f(FILTER_NAIVE_2_POLE * nv) + 1)); x = filterPos((t >= FILTER_OFF ? FILTER_OFF - 1 : t) - 1); }
    else x = toU8(f(nv * 127)) != 0 ? MODE_MAX : 0;
  }
  dispatch(par, 0, true, f(x / 127));
}
void LxrEngine::setOriginal(int par) {
  if (par < 0 || par >= 256 || !MODULATABLE[par]) return;
  dispatch(par, activeParameters[par], false, 0);
}
void LxrEngine::resetTargets() {
  for (int n = 0; n < 6; n++) for (auto& r : routes[n]) if (r.on) { routeReset(n, r.dest); for (auto& c : r.c) c = 0; }
}
void LxrEngine::lfoRetrigger(int voice) {
  for (auto& v : voices) if (v.lfo.retrigger == voice + 1) v.lfo.phase = v.lfo.phaseOffset;
}
void LxrEngine::lfoSetFreq(Lfo& lfo, double x) {
  x = f(f(0.0078125) + f(x * f(1 - f(0.0078125))));
  x = f(f(x * x) * x);
  lfo.freq = f(x * LFO_MAX_F);
  lfo.phaseInc = lfo_calcPhaseInc(lfo.freq, lfo.sync, bpm);
}

void LxrEngine::triggerOne(int n, int vel, int note, int open) {
  Voice& v = voices[n]; const bool drum = v.kind == KIND_DRUM;
  lfoRetrigger(n);
  velLast[n] = (float)f(vel / 127.0);
  routesFrom(n, SRC_VEL, velLast[n]);
  stepPlayed[n] = 0; stepClock[n] = 0;
  stepTarget[n] = stepNow[n] = stepLevels[n * NUM_STEPS];
  routesFrom(n, SRC_STEP, stepNow[n]);
  double offset = 1;
  if (v.transGen.waveform == 1) offset = f(offset - v.transGen.volume);
  resetPhase(v.osc, offset, drum);
  if (drum) resetPhase(v.modOsc, 1, true); else v.modOsc.phase = 0;
  v.modOsc2.phase = 0;
  osc_setBaseNote(v.osc, note);
  osc_setBaseNote(v.modOsc, note);
  osc_setBaseNote(v.modOsc2, note);
  v.oscPitchEg.value = 1;
  if (v.hatDecays) { v.isOpen = open; v.oscVolEg.decay = open ? v.decayOpen : v.decayClosed; }
  slopeEg2_trigger(v.oscVolEg);
  v.velo = f(vel / 127.0);
  v.transGen.phase = 0;
  v.snapValue = 1;
  if (drum) SVF_reset(v.filter);
  if (v.fw) std::memcpy(v.fwAt, v.fwTo, sizeof(v.fwTo));
  updatePan(v);
}

void LxrEngine::async(Voice& v) {
  voiceParts(v);
  double egPitch = 0;
  if (v.pitchEg) { egPitch = decayEg_calc(v.oscPitchEg); v.osc.pitchMod = f(1 + f(egPitch * v.egPitchModAmount)); }
  v.egPitchNow = egPitch;
  if (v.transGen.waveform == 0) {
    const double snap = snapEg_calc(v.snapValue, v.transGen.pitch);
    v.osc.pitchMod = f((v.pitchEg ? v.osc.pitchMod : 1) + f(snap * v.transGen.volume));
  }
  if (v.fmEnv == 1) v.osc.fmMod = f(v.fmModAmount * egPitch);
  else if (v.fmEnv > 0) v.osc.fmMod = f(f(1 - v.fmEnv) + f(v.fmEnv * f(v.fmModAmount * egPitch)));
  else if (v.srcA || v.srcB) v.osc.fmMod = 1;
  if (v.kind == KIND_DRUM) {
    SlopeEg& eg = v.oscVolEg;
    if (eg.attack == 1 && (eg.state == EG_A || eg.state == EG_REPEAT)) { v.ampFilterInput = slopeEg2_calc(eg); v.lastGain = v.ampFilterInput; }
    else { v.lastGain = v.ampFilterInput; v.ampFilterInput = slopeEg2_calc(eg); }
  } else v.egValueOscVol = f(slopeEg2_calc(v.oscVolEg));
  osc_setFreq(v.osc);
  if (v.srcA) osc_setFreq(v.modOsc);
  if (v.srcB) osc_setFreq(v.modOsc2);
  if (v.srcN) osc_setFreq(v.noiseOsc);
}

void LxrEngine::sync(int n, int16_t* buf) {
  Voice& v = voices[n]; const int size = BLOCK; int16_t *A = bA, *B = bB, *N = bN, *C = bC;
  if (v.srcA) calcNextOscSampleBlock(v.modOsc, A, size, v.fmModAmount, v.pwm, rng);
  if (v.srcB) {
    calcNextOscSampleBlock(v.modOsc2, B, size, v.fmModAmount2, v.pwm, rng);
    if (v.srcA) for (int i = 0; i < size; i++) A[i] = (int16_t)qadd16(A[i], B[i]);
    else std::memcpy(A, B, sizeof(bA));
  }
  const bool snare = v.kind == KIND_SNARE && !v.routeT && v.routeN && !v.routeC && v.srcN;
  if (v.srcN) calcNoiseBlock(v.noiseOsc, N, size, snare ? f(0.9) : f(f(0.9) * v.mix), rng);
  const double m = v.srcA ? v.mixAmt : 0; const bool mixA = m >= 1;
  double g = mixA ? f(1 - v.fmModAmount) : v.carrierGain;
  if (m > 0 && !mixA) g = f(v.carrierGain + f(f(f(1 - v.fmModAmount) - v.carrierGain) * m));
  if (v.mix != 0) g = f(g * f(1 - v.mix));
  if (mixA) {
    calcNextOscSampleBlock(v.osc, buf, size, g, v.pwm, rng);
    for (int i = 0; i < size; i++) buf[i] = (int16_t)qadd16(buf[i], A[i]);
  } else if (m > 0) {
    int16_t* M = bM; const double mf = f(1 - m);
    for (int i = 0; i < size; i++) M[i] = (int16_t)toI16(f(A[i] * mf));
    calcNextOscSampleFmBlock(v.osc, M, buf, size, g, v.pwm, rng);
    for (int i = 0; i < size; i++) buf[i] = (int16_t)qadd16(buf[i], toI16(f(A[i] * m)));
  } else if (v.srcA || v.srcB) calcNextOscSampleFmBlock(v.osc, A, buf, size, g, v.pwm, rng);
  else calcNextOscSampleBlock(v.osc, buf, size, g, v.pwm, rng);
  transient_calcBlock(v.transGen, C, size);
  if (snare) { snareFinish(n, v, buf); return; }
  int16_t* T = bT; const bool toFilter = v.routeT || v.routeC || (v.srcN && v.routeN);
  if (!v.routeT) { std::memcpy(T, buf, sizeof(bT)); std::fill(buf, buf + size, 0); }
  if (v.routeC) for (int i = 0; i < size; i++) buf[i] = (int16_t)qadd16(buf[i], C[i]);
  if (v.srcN && v.routeN) for (int i = 0; i < size; i++) buf[i] = (int16_t)qadd16(buf[i], N[i]);
  if (toFilter) filterBlock(v, buf);
  if (!v.routeT) for (int i = 0; i < size; i++) buf[i] = (int16_t)qadd16(buf[i], T[i]);
  if (!v.routeC) for (int i = 0; i < size; i++) buf[i] = (int16_t)qadd16(buf[i], C[i]);
  if (v.srcN && !v.routeN) for (int i = 0; i < size; i++) buf[i] = (int16_t)qadd16(buf[i], N[i]);
  if (v.kind == KIND_DRUM) {
    const double gain = f(v.ampFilterInput), last = f(v.lastGain), d = f(gain - last);
    for (int i = 0; i < size; i++) buf[i] = (int16_t)toI16(buf[i] * (last + f(i / f(size - 1)) * d));
    if (v.volumeMod) for (int i = 0; i < size; i++) buf[i] = (int16_t)toI16(f(buf[i] * v.velo));
    for (int i = 0; i < size; i++) buf[i] = (int16_t)distortSample(buf[i], calcOnePole(v.driveFilter, v.distShape));
    for (int i = 0; i < size; i++) {
      const double mixVol = calcOnePole(v.mixerVolFilter, v.vol);
      v.combinedVolume = f(mixVol * calcOnePole(v.faderFilter, faderVolume[n]));
      buf[i] = (int16_t)toI16(f(buf[i] * v.combinedVolume));
    }
  } else {
    v.combinedVolume = v.volumeMod ? f(f(v.vol * v.velo) * v.egValueOscVol) : f(v.vol * v.egValueOscVol);
    for (int j = 0; j < size; j++) buf[j] = (int16_t)toI16(f(buf[j] * f(v.combinedVolume * calcOnePole(v.faderFilter, faderVolume[n]))));
    for (int j = 0; j < size; j++) buf[j] = (int16_t)distortSample(buf[j], v.distShape);
  }
}
void LxrEngine::snareFinish(int n, Voice& v, int16_t* buf) {
  int16_t *N = bN, *C = bC; const int size = BLOCK;
  filterBlock(v, N);
  v.combinedVolume = v.volumeMod ? f(f(v.vol * v.velo) * v.egValueOscVol) : f(v.vol * v.egValueOscVol);
  for (int j = 0; j < size; j++) {
    double tmp = (double)std::fmaf((float)N[j], (float)v.mix, (float)buf[j]);
    tmp = f(tmp + C[j]);
    buf[j] = (int16_t)toI16(f(f(v.combinedVolume * tmp) * calcOnePole(v.faderFilter, faderVolume[n])));
  }
  for (int j = 0; j < size; j++) buf[j] = (int16_t)distortSample(buf[j], v.distShape);
}
void LxrEngine::decimate(int n, int16_t* buf) {
  const double inc = f((double)decimationRate[n] * decimationRate[6]);
  for (int i = 0; i < BLOCK; i++) {
    decimationCnt[n] = (float)f(decimationCnt[n] + inc);
    if (decimationCnt[n] >= 1) { decimationCnt[n] = (float)f(decimationCnt[n] - 1.0); voiceSamples[n] = buf[i]; }
    buf[i] = voiceSamples[n];
  }
}

void LxrEngine::renderBlock() {
  resetTargets();
  for (int n = 0; n < 6; n++) { stepRun(n); routesFrom(n, SRC_VEL, velLast[n]); routesFrom(n, SRC_STEP, stepNow[n]); }
  for (int n = 0; n < 6; n++) { const double x = lfo_calc(voices[n].lfo, rng); routesFrom(n, SRC_LFO, x); }
  for (int n = 0; n < 6; n++) {
    Voice& v = voices[n];
    routesFrom(n, SRC_AMP, v.kind == KIND_DRUM ? v.ampFilterInput : v.egValueOscVol);
    routesFrom(n, SRC_PITCH, v.pitchEg ? v.egPitchNow : 0);
    routesFrom(n, SRC_MACRO, 1);  // (the MACRO knobs: their amount as it is)
  }
  for (auto& v : voices) SVF_recalcFreq(v.filter);
  for (int n = 0; n < 6; n++) if (onlyAll || only[n]) async(voices[n]);
  for (int n = 0; n < 6; n++) {
    if (!onlyAll && !only[n]) { std::fill(out[n], out[n] + BLOCK, 0); continue; }
    sync(n, out[n]); decimate(n, out[n]);
  }
}

// ---- midiParser_ccHandler() ----
void LxrEngine::ccHandler(bool isCC2, int num, double data2, bool isFloat, double v) {
  int itg; double flt;
  if (isFloat) { itg = toU8(f(v * 127)); flt = f(v); }
  else { itg = jsI32(data2) & 0xff; flt = f(data2 / 127); }
  const double val = isFloat ? f(v * 127) : data2;
  Voice &d0 = voices[0], &d1 = voices[1], &d2 = voices[2], &sn = voices[3], &cy = voices[4], &hh = voices[5];
  Voice* drums[3] = {&d0, &d1, &d2};
  Voice* all6[6] = {&d0, &d1, &d2, &sn, &cy, &hh};
  auto wave = [&](int count) { if (!isFloat) return itg; const int w = toU8(f(count * flt)); return w >= count ? count - 1 : w; };
  auto pitchModAmount = [](double x) { const double vv = f(x / 127); return f(f(vv * vv) * 32); };
  auto filterValue = [&]() { return valueShaperF2F(flt, FILTER_SHAPER); };
  auto transPitch = [&]() { return f(1 + f(f(val / f(33.9)) - f(0.75))); };
  auto pos = [&]() { return isFloat ? f(flt * 127) : data2; };
  auto wpos = [&](Osc& osc) { osc_setPos(osc, pos()); };

  if (!isCC2) {
    if (num >= CC_FREQ_LFO1 && num <= CC_FREQ_LFO6) { lfoSetFreq(voices[num - CC_FREQ_LFO1].lfo, flt); return; }
    if (num >= CC_VOICE_DECIMATION1 && num <= CC_VOICE_DECIMATION_ALL) { decimationRate[num - CC_VOICE_DECIMATION1] = (float)valueShaperF2F(flt, f(-0.7)); return; }
    switch (num) {
      case CC_NRPN_DATA_ENTRY_COARSE: ccHandler(true, activeNrpnNumber & 0xff, itg, false, 0); return;
      case CC_NRPN_FINE: activeNrpnNumber = (activeNrpnNumber & ~0x7f) | (itg & 0x7f); break;
      case CC_NRPN_COARSE: activeNrpnNumber = ((activeNrpnNumber & 0x7f) | (itg << 7)) & 0xffff; break;
      case CC_VOL_SLOPE1: slopeEg2_setSlope(d0.oscVolEg, val); break;
      case CC_PITCH_SLOPE1: decayEg_setSlope(d0.oscPitchEg, val); break;
      case CC_VOL_SLOPE2: slopeEg2_setSlope(d1.oscVolEg, val); break;
      case CC_PITCH_SLOPE2: decayEg_setSlope(d1.oscPitchEg, val); break;
      case CC_VOL_SLOPE3: slopeEg2_setSlope(d2.oscVolEg, val); break;
      case CC_PITCH_SLOPE3: decayEg_setSlope(d2.oscPitchEg, val); break;
      case CC_PITCH_SLOPE4: decayEg_setSlope(sn.oscPitchEg, val); break;
      case CC_VOL_SLOPE6: slopeEg2_setSlope(hh.oscVolEg, val); break;
      case CC_FILTER_FREQ_DRUM1: case CC_FILTER_FREQ_DRUM2: case CC_FILTER_FREQ_DRUM3:
        SVF_directSetFilterValue(drums[num - CC_FILTER_FREQ_DRUM1]->filter, filterValue()); break;
      case CC_RESO_DRUM1: case CC_RESO_DRUM2: case CC_RESO_DRUM3:
        SVF_setReso(drums[num - CC_RESO_DRUM1]->filter, flt); break;
      case CC_F_OSC1_COARSE: setCoarse(d0.osc, val); break;
      case CC_F_OSC2_COARSE: setCoarse(d1.osc, val); break;
      case CC_F_OSC3_COARSE: setCoarse(d2.osc, val); break;
      case CC_F_OSC4_COARSE: setCoarse(sn.osc, val); break;
      case CC_F_OSC5_COARSE: setCoarse(cy.osc, val); break;
      case CC_F_OSC1_FINE: setFine(d0.osc, val); break;
      case CC_F_OSC2_FINE: setFine(d1.osc, val); break;
      case CC_F_OSC3_FINE: setFine(d2.osc, val); break;
      case CC_F_OSC4_FINE: setFine(sn.osc, val); break;
      case CC_F_OSC5_FINE: setFine(cy.osc, val); break;
      case CC_F_OSC6_FINE: setFine(hh.osc, val); break;
      case CC_OSC_WAVE_DRUM1: wpos(d0.osc); break;
      case CC_MOD_WAVE_DRUM1: wpos(d0.modOsc); break;
      case CC_OSC_WAVE_DRUM2: wpos(d1.osc); break;
      case CC_MOD_WAVE_DRUM2: wpos(d1.modOsc); break;
      case CC_OSC_WAVE_DRUM3: wpos(d2.osc); break;
      case CC_MOD_WAVE_DRUM3: wpos(d2.modOsc); break;
      case CC_OSC_WAVE_SNARE: wpos(sn.osc); break;
      case CC_OSC1_DIST: d0.distShape = distShape(flt); break;
      case CC_OSC2_DIST: d1.distShape = distShape(flt); break;
      case CC_OSC3_DIST: d2.distShape = distShape(flt); break;
      case CC_VELOA1: d0.oscVolEg.attack = slopeEg2_calcTime(val, TIME_K_ATTACK); break;
      case CC_VELOD1: d0.oscVolEg.decay = slopeEg2_calcTime(val, TIME_K_DECAY); break;
      case CC_PITCHD1: d0.oscPitchEg.decay = decayEg_calcTime(val); break;
      case CC_MODAMNT1: d0.egPitchModAmount = pitchModAmount(val); break;
      case CC_FMAMNT1: d0.fmModAmount = flt; break;
      case CC_FMDTN1: setCoarse(d0.modOsc, val); break;
      case CC_VOL1: d0.vol = flt; break;
      case CC_PAN1: d0.pan = val; break;
      case CC_VELOA2: d1.oscVolEg.attack = slopeEg2_calcTime(val, TIME_K_ATTACK); break;
      case CC_VELOD2: d1.oscVolEg.decay = slopeEg2_calcTime(val, TIME_K_DECAY); break;
      case CC_PITCHD2: d1.oscPitchEg.decay = decayEg_calcTime(val); break;
      case CC_MODAMNT2: d1.egPitchModAmount = pitchModAmount(val); break;
      case CC_FMAMNT2: d1.fmModAmount = flt; break;
      case CC_FMDTN2: setCoarse(d1.modOsc, val); break;
      case CC_VOL2: d1.vol = flt; break;
      case CC_PAN2: d1.pan = val; break;
      case CC_VELOA3: d2.oscVolEg.attack = slopeEg2_calcTime(val, TIME_K_ATTACK); break;
      case CC_VELOD3: d2.oscVolEg.decay = slopeEg2_calcTime(val, TIME_K_DECAY); break;
      case CC_PITCHD3: d2.oscPitchEg.decay = decayEg_calcTime(val); break;
      case CC_MODAMNT3: d2.egPitchModAmount = pitchModAmount(val); break;
      case CC_FMAMNT3: d2.fmModAmount = flt; break;
      case CC_FMDTN3: setCoarse(d2.modOsc, val); break;
      case CC_VOL3: d2.vol = flt; break;
      case CC_PAN3: d2.pan = val; break;
      case CC_VOL4: sn.vol = flt; break;
      case CC_PAN4: sn.pan = val; break;
      case CC_SNARE_NOISE_F: sn.noiseOsc.freq = f(flt * 22000); break;
      case CC_VELOA4: sn.oscVolEg.attack = slopeEg2_calcTime(val, TIME_K_ATTACK); break;
      case CC_VELOD4: sn.oscVolEg.decay = slopeEg2_calcTime(val, TIME_K_DECAY); break;
      case CC_PITCHD4: sn.oscPitchEg.decay = decayEg_calcTime(val); break;
      case CC_MODAMNT4: sn.egPitchModAmount = pitchModAmount(val); break;
      case CC_SNARE_FILTER_F: SVF_directSetFilterValue(sn.filter, filterValue()); break;
      case CC_SNARE_RESO: SVF_setReso(sn.filter, flt); break;
      case CC_SNARE_MIX: sn.mix = flt; break;
      case CC_VOL5: cy.vol = flt; break;
      case CC_PAN5: cy.pan = val; break;
      case CC_VELOA5: cy.oscVolEg.attack = slopeEg2_calcTime(val, TIME_K_ATTACK); break;
      case CC_VELOD5: cy.oscVolEg.decay = slopeEg2_calcTime(val, TIME_K_DECAY); break;
      case CC_CYM_WAVE1: wpos(cy.osc); break;
      case CC_CYM_WAVE2: wpos(cy.modOsc); break;
      case CC_CYM_WAVE3: wpos(cy.modOsc2); break;
      case CC_CYM_MOD_OSC_F1: setCoarse(cy.modOsc, val); break;
      case CC_CYM_MOD_OSC_F2: setCoarse(cy.modOsc2, val); break;
      case CC_CYM_MOD_OSC_GAIN1: cy.fmModAmount = flt; break;
      case CC_CYM_MOD_OSC_GAIN2: cy.fmModAmount2 = flt; break;
      case CC_CYM_FIL_FREQ: SVF_directSetFilterValue(cy.filter, filterValue()); break;
      case CC_CYM_RESO: SVF_setReso(cy.filter, flt); break;
      case CC_CYM_REPEAT: cy.oscVolEg.repeat = itg; break;
      case CC_CYM_SLOPE: slopeEg2_setSlope(cy.oscVolEg, val); break;
      case CC_WAVE1_HH: wpos(hh.osc); break;
      case CC_WAVE2_HH: wpos(hh.modOsc); break;
      case CC_WAVE3_HH: wpos(hh.modOsc2); break;
      case CC_VELOD6: hh.decayClosed = f(slopeEg2_calcTime(val, TIME_K_DECAY)); break;
      case CC_VELOD6_OPEN: hh.decayOpen = f(slopeEg2_calcTime(val, TIME_K_DECAY)); break;
      case CC_HAT_FILTER_F: SVF_directSetFilterValue(hh.filter, filterValue()); break;
      case CC_HAT_RESO: SVF_setReso(hh.filter, flt); break;
      case CC_VOL6: hh.vol = flt; break;
      case CC_PAN6: hh.pan = val; break;
      case CC_F_OSC6_COARSE: setCoarse(hh.osc, val); break;
      case CC_MOD_OSC_F1: setCoarse(hh.modOsc, val); break;
      case CC_MOD_OSC_F2: setCoarse(hh.modOsc2, val); break;
      case CC_MOD_OSC_GAIN1: hh.fmModAmount = flt; break;
      case CC_MOD_OSC_GAIN2: hh.fmModAmount2 = flt; break;
      case CC_VELOA6: hh.oscVolEg.attack = slopeEg2_calcTime(val, TIME_K_ATTACK); break;
      case CC_REPEAT1: sn.oscVolEg.repeat = itg; break;
      case CC_EG_SNARE1_SLOPE: slopeEg2_setSlope(sn.oscVolEg, val); break;
      case CC_SNARE_DISTORTION: sn.distShape = distShape(flt); break;
      case CC_CYMBAL_DISTORTION: cy.distShape = distShape(flt); break;
      case CC_HAT_DISTORTION: hh.distShape = distShape(flt); break;
      default: break;
    }
    return;
  }
  if (num >= CC2_TRANS1_WAVE && num <= CC2_TRANS3_WAVE) { transient_setWaveform(drums[num - CC2_TRANS1_WAVE]->transGen, wave(NUM_WAVES)); return; }
  if (num >= CC2_TRANS1_VOL && num <= CC2_TRANS3_VOL) { drums[num - CC2_TRANS1_VOL]->transGen.volume = flt; return; }
  if (num >= CC2_TRANS1_FREQ && num <= CC2_TRANS3_FREQ) { drums[num - CC2_TRANS1_FREQ]->transGen.pitch = transPitch(); return; }
  if (num >= CC2_FILTER_TYPE_1 && num <= CC2_FILTER_TYPE_6) { voice_setFilterPos(*all6[num - CC2_FILTER_TYPE_1], pos()); return; }
  if (num >= CC2_FILTER_DRIVE_1 && num <= CC2_FILTER_DRIVE_6) { SVF_setDrive(all6[num - CC2_FILTER_DRIVE_1]->filter, flt); return; }
  if (num >= CC2_MIX_MOD_1 && num <= CC2_MIX_MOD_3) { drums[num - CC2_MIX_MOD_1]->mixAmt = flt; return; }
  if (num >= CC2_VOLUME_MOD_ON_OFF1 && num <= CC2_VOLUME_MOD_ON_OFF6) { all6[num - CC2_VOLUME_MOD_ON_OFF1]->volumeMod = itg != 0 ? 1 : 0; return; }
  if (num >= CC2_VELO_MOD_AMT_1 && num <= CC2_VELO_MOD_AMT_6) return;
  if (num >= CC2_WAVE_LFO1 && num <= CC2_WAVE_LFO6) { voices[num - CC2_WAVE_LFO1].lfo.waveform = wave(NUM_LFO_WAVEFORMS); return; }
  if (num >= CC2_RETRIGGER_LFO1 && num <= CC2_RETRIGGER_LFO6) { voices[num - CC2_RETRIGGER_LFO1].lfo.retrigger = isFloat ? toU8(f(7 * flt)) : itg; return; }
  if (num >= CC2_SYNC_LFO1 && num <= CC2_SYNC_LFO6) {
    Lfo& lfo = voices[num - CC2_SYNC_LFO1].lfo;
    lfo.sync = itg; lfo.phaseInc = lfo_calcPhaseInc(lfo.freq, lfo.sync, bpm); return;
  }
  if (num >= CC2_OFFSET_LFO1 && num <= CC2_OFFSET_LFO6) { voices[num - CC2_OFFSET_LFO1].lfo.phaseOffset = toU32(f(flt * F_2POW32)); return; }
  if (num >= CC2_AUDIO_OUT1 && num <= CC2_AUDIO_OUT6) { audioRouting[num - CC2_AUDIO_OUT1] = (uint8_t)itg; return; }
  if (num >= CC2_PWM_1 && num <= CC2_PWM_3) { drums[num - CC2_PWM_1]->pwm = flt; return; }
  switch (num) {
    case CC2_TRANS4_WAVE: transient_setWaveform(sn.transGen, wave(NUM_WAVES)); break;
    case CC2_TRANS5_WAVE: transient_setWaveform(cy.transGen, wave(NUM_WAVES)); break;
    case CC2_TRANS6_WAVE: transient_setWaveform(hh.transGen, wave(NUM_WAVES)); break;
    case CC2_TRANS4_VOL: sn.transGen.volume = flt; break;
    case CC2_TRANS5_VOL: cy.transGen.volume = flt; break;
    case CC2_TRANS6_VOL: hh.transGen.volume = flt; break;
    case CC2_TRANS4_FREQ: sn.transGen.pitch = transPitch(); break;
    case CC2_TRANS5_FREQ: cy.transGen.pitch = transPitch(); break;
    case CC2_TRANS6_FREQ: hh.transGen.pitch = transPitch(); break;
    case CC2_PWM_4: sn.pwm = flt; break;
    case CC2_PWM_5: cy.pwm = flt; break;
    case CC2_PWM_6: hh.pwm = flt; break;
    default: break;  // (the FX bus of the engine itself is never heard in LXR-AFX: its settings change nothing)
  }
}

// =====================================================================================================================
// The echo (FxBus.c's delay)
// =====================================================================================================================
namespace {
constexpr int FX_BUFFER_SIZE = 0x7fff;
constexpr int SYNC_BUFFER_SIZE = 0x7ffff;
const double F_REAL_FS = f(REAL_FS);
const double LOW_MIN = f(0.0006 * REAL_FS), LOW_MAX = f(0.02 * REAL_FS), HI_MIN = f(0.02 * REAL_FS), HI_MAX = f(FX_BUFFER_SIZE);
const double PP_MAX = f(FX_BUFFER_SIZE * f(0.48));
constexpr int DELAY_NORMAL = 0;

double toHalf(double x) {
  const double a = std::fabs(x);
  if (a == 0) return x;
  const double e = a < 6.103515625e-5 ? -14 : std::floor(std::log2(a));
  double ee = e;
  if (a >= 6.103515625e-5) { if (std::pow(2.0, ee) > a) ee--; else if (std::pow(2.0, ee + 1) <= a) ee++; }
  const double q = std::pow(2.0, ee - 10);
  const double m = a / q;
  double r = std::floor(m);
  const double d = m - r;
  if (d > 0.5 || (d == 0.5 && (((int64_t)r) & 1))) r++;
  const double v = r * q;
  return x < 0 ? -v : v;
}
inline double interpF(double a, double b, double x) { return f(f(a * f(1 - x)) + f(b * x)); }
double calcDelayTime(const Delay& d, double cv) {
  const double mn = interpF(LOW_MIN, HI_MIN, d.range);
  const double mx = interpF(LOW_MAX, d.type == DELAY_NORMAL ? HI_MAX : PP_MAX, d.range);
  return interpF(mn, mx, cv);
}
void delaySetDelayTime(Delay& d, double t) {
  if (d.interpValue <= 0) {
    d.delayTime = t;
    const double offset = d.hasSync ? d.sync : calcDelayTime(d, f(d.delayTime * d.range));
    const uint32_t offItg = toU32(offset);
    d.fracReadNew = f(offset - offItg);
    d.newRead = (uint32_t)(d.write - 1) - offItg;
    d.newRead &= (uint32_t)(d.type == DELAY_NORMAL ? d.mask : d.mask >> 1);
    d.interpValue = f(1);
    d.interpStep = f(1 / f(F_REAL_FS * f(0.01)));
  } else {
    d.pendingDelayTime = t;
    d.timePending = 1;
  }
}
inline int16_t delayRead(const float* buf, int base, uint32_t pos, int mask, double frac) {
  const uint32_t pos2 = (pos + 1) & (uint32_t)mask;
  return (int16_t)toI16(f(interpF(buf[base + pos], buf[base + pos2], frac) * F_32767));
}
void delayCalcBuffer(Delay& d, const float* buf, int idx) {
  if (idx == 0) { d.tmp[0] = delayRead(buf, 0, d.oldRead, d.mask, d.fracReadOld); d.oldRead = (d.oldRead + 1) & (uint32_t)d.mask; }
  else { d.tmp[1] = delayRead(buf, 0, d.newRead, d.mask, d.fracReadNew); d.newRead = (d.newRead + 1) & (uint32_t)d.mask; }
}
void delayCalcBufferPingPong(Delay& d, const float* buf, int idx) {
  const int half = d.mask >> 1;
  if (idx == 0) {
    d.tmp[0] = delayRead(buf, 0, d.oldRead, half, d.fracReadOld);
    d.tmp2[0] = delayRead(buf, half, d.oldRead, half, d.fracReadOld);
    d.oldRead = (d.oldRead + 1) & (uint32_t)half;
  } else {
    d.tmp[1] = delayRead(buf, 0, d.newRead, half, d.fracReadNew);
    d.tmp2[1] = delayRead(buf, half, d.newRead, half, d.fracReadNew);
    d.newRead = (d.newRead + 1) & (uint32_t)half;
  }
}
inline int crossfade(double a, double b, double v) { return toI16(f(a * v) + b * (1.0 - v)); }
inline float toBuf(double itg) { double v = f(itg / F_32767); if (v > 1) v = f(1); else if (v < -1) v = f(-1); return (float)toHalf(v); }
void delayStep(Delay& d, bool pingPong, const float* buf, int& l, int& r) {
  auto calc = pingPong ? delayCalcBufferPingPong : delayCalcBuffer;
  if (d.interpValue <= 0) {
    calc(d, buf, 0);
    l = d.tmp[0]; r = d.tmp2[0];
    if (d.timePending) { d.timePending = 0; delaySetDelayTime(d, d.pendingDelayTime); }
  } else {
    calc(d, buf, 0);
    calc(d, buf, 1);
    l = crossfade(d.tmp[0], d.tmp[1], d.interpValue);
    if (pingPong) r = crossfade(d.tmp2[0], d.tmp2[1], d.interpValue); else r = 0;
    d.interpValue = f(d.interpValue - d.interpStep);
    if (d.interpValue <= 0) { d.oldRead = d.newRead; d.fracReadOld = d.fracReadNew; }
  }
}
}  // namespace

EchoBus::EchoBus() : buffer(SYNC_BUFFER_SIZE + 1, 0.0f) {
  delay.mask = FX_BUFFER_SIZE; delay.write = FX_BUFFER_SIZE / 20 - 10; delay.feedback = f(0.7);
  delay.tone = makeOnePole(); delay.tone2 = makeOnePole();
}
void EchoBus::setParameter(int idx, double value) {
  parameter[idx] = (float)value;
  const double* dummy = nullptr; (void)dummy;
  Delay& d = delay; const double p0 = parameter[0], p1 = parameter[1], p2 = parameter[2], p3 = parameter[3];
  d.range = p1; delaySetDelayTime(d, d.delayTime);
  delaySetDelayTime(d, p0);
  d.tone.r = f(f(p2 * p2)); d.tone2.r = f(f(p2 * p2));
  d.feedback = p3;
}
void EchoBus::setDelaySync(double samples) {
  Delay& d = delay;
  d.mask = SYNC_BUFFER_SIZE;
  const double mx = (d.type == DELAY_NORMAL ? d.mask : d.mask >> 1) - 2;
  samples = jsMax(1, jsMin(mx, samples));
  if (d.hasSync && std::fabs(samples - d.sync) < 0.5) return;
  d.hasSync = true; d.sync = samples;
  delaySetDelayTime(d, d.delayTime);
}
void EchoBus::process(int16_t* out, int size) {
  Delay& d = delay; const int16_t* fx = input; float* buf = buffer.data();
  if (d.type == DELAY_NORMAL) {
    for (int i = 0; i < size; i++) {
      const int x0 = fx[2 * i], x1 = fx[2 * i + 1];
      int o, r; delayStep(d, false, buf, o, r);
      o = toI16(calcOnePole(d.tone, o));
      const int itg = qadd16(qadd16(x0, x1), toI16(f(o * d.feedback)));
      buf[d.write++] = toBuf(itg);
      d.write &= d.mask;
      out[2 * i] = (int16_t)qadd16(out[2 * i], wrap16(ssat16(x0 + ssat16(toI32(f((o - x0) * 1.0))))));
      out[2 * i + 1] = (int16_t)qadd16(out[2 * i + 1], wrap16(ssat16(x1 + ssat16(toI32(f((o - x1) * 1.0))))));
    }
  } else {
    const int half = d.mask >> 1;
    for (int i = 0; i < size; i++) {
      const int x0 = fx[2 * i], x1 = fx[2 * i + 1];
      int l, r; delayStep(d, true, buf, l, r);
      l = toI16(calcOnePole(d.tone, l));
      r = toI16(calcOnePole(d.tone2, r));
      buf[half + d.write] = toBuf(qadd16(x0, toI16(f(l * d.feedback))));
      buf[d.write++] = toBuf(qadd16(x1, toI16(f(r * d.feedback))));
      d.write &= half;
      out[2 * i] = (int16_t)qadd16(out[2 * i], wrap16(ssat16(x0 + ssat16(toI32(f((l - x0) * 1.0))))));
      out[2 * i + 1] = (int16_t)qadd16(out[2 * i + 1], wrap16(ssat16(x1 + ssat16(toI32(f((r - x1) * 1.0))))));
    }
  }
}

// =====================================================================================================================
// The reverb (FX/Reverb.c)
// =====================================================================================================================
namespace {
constexpr int VERB_SIZE = 0x800;
VerbDelay makeVerbDelay() { VerbDelay d; d.buf.assign(VERB_SIZE, 0.0f); return d; }
void verbCalcLength(VerbDelay& d) {
  double pos = d.writePtr - f(d.length * d.roomSz);
  if (pos < 0) pos += VERB_SIZE;
  d.readPtr = jsI32(std::trunc(pos)) & (VERB_SIZE - 1);
}
void verbSetLength(VerbDelay& d, double l) { d.length = l; verbCalcLength(d); }
void verbSetRoomSize(VerbDelay& d, double sz) { d.roomSz = sz; verbCalcLength(d); }
inline double verbRead(VerbDelay& d) { const double r = d.buf[d.readPtr]; d.readPtr = (d.readPtr + 1) & (VERB_SIZE - 1); return r; }
inline void verbWrite(VerbDelay& d, double x) { d.buf[d.writePtr] = (float)x; d.writePtr = (d.writePtr + 1) & (VERB_SIZE - 1); }
inline double verbReadTap(const VerbDelay& d, double percent) { const int off = jsI32(std::trunc(percent / 100 * d.length)) & 0xffff; return d.buf[(d.readPtr - off) & (VERB_SIZE - 1)]; }
inline double verbReadTapSample(const VerbDelay& d, int idx) { return d.buf[(d.readPtr - idx) & (VERB_SIZE - 1)]; }
inline double verbProcess(VerbDelay& d, double x) { verbWrite(d, x); return verbRead(d); }
VerbDelay makeVerbModDelay() {
  VerbDelay d = makeVerbDelay(); d.mod = true; d.lp = makeOnePole(); d.frac = 0; d.depth = 0; d.modVal = 0;
  d.lp.r = f(1 - std::exp(-2 * PI * 0.0001308911269084528 / REAL_FS));
  return d;
}
void verbModCalcLength(VerbDelay& d) {
  const double filtered = calcOnePole(d.lp, f(d.length * d.roomSz) + d.depth * d.modVal);
  double pos = d.writePtr - filtered;
  if (pos < 0) pos += VERB_SIZE;
  const double itg = std::trunc(pos);
  d.frac = pos - itg; d.readPtr = jsI32(itg) & (VERB_SIZE - 1);
}
void verbModSetLength(VerbDelay& d, double l) { d.length = l; d.lp.b = f(l * d.roomSz); }
void verbModSetValue(VerbDelay& d, double v) { d.modVal = v; verbModCalcLength(d); }
Allpass makeAllpass(bool mod) { Allpass a; a.g = 0.5; a.mod = mod; a.d = mod ? makeVerbModDelay() : makeVerbDelay(); return a; }
inline double allpassProcess(Allpass& a, double x) {
  if (a.mod) verbModCalcLength(a.d);
  a.out = verbRead(a.d);
  a.in = x + a.g * a.out;
  verbWrite(a.d, a.in);
  return a.out + -a.g * a.in;
}
void tiltSetFreq(Tilt& e, double fc) { const double w = 2 * PI * fc, n = 1 / (3.0 * REAL_FS + w); e.a0 = 2 * w * n; e.b1 = (3.0 * REAL_FS - w) * n; }
Tilt makeTilt() { Tilt e; tiltSetFreq(e, 400); return e; }
void tiltSetParameter(Tilt& e, double p) {
  p = p * p * p;
  if (p >= 0) { e.lgain = 0; e.hgain = 1; tiltSetFreq(e, 20000 * p); } else { e.lgain = 1; e.hgain = 0; tiltSetFreq(e, 20000 * (1 + p)); }
}
inline double tiltProcess(Tilt& e, double x) { e.lp = e.a0 * x + e.b1 * e.lp; return e.lgain * e.lp + e.hgain * (x - e.lp); }
const double VERB_EARLY[4] = {12, 24, 38, 50};
const double VERB_EARLY_R[4] = {8, 19, 33, 45};
constexpr double VERB_R = 0.6;
}  // namespace

ReverbBus::ReverbBus() {
  eq = makeTilt(); eqFb = makeTilt(); eqFbR = makeTilt();
  lfoA = 2 * std::sin(PI * 1.31 / REAL_FS);
  lpFeedback = makeOnePole(); lpFeedback.r = 0.5; lpImpulse = makeOnePole(); lpImpulse.r = 0.5;
  apDelay[0] = makeAllpass(false); apDelay[1] = makeAllpass(false); apModDelay[0] = makeAllpass(true); apModDelay[1] = makeAllpass(true);
  for (auto& a : inputAllpass) a = makeAllpass(false);
  for (auto& d : delay) d = makeVerbDelay();
  early = makeVerbDelay(); preDelay = makeVerbDelay();
  verbSetLength(early, 2000); verbSetLength(preDelay, 2031);
  const double ia[4] = {142, 107, 379, 277}; for (int i = 0; i < 4; i++) verbSetLength(inputAllpass[i].d, ia[i]);
  const double dl[4] = {2047, 1913, 1720, 1163}; for (int i = 0; i < 4; i++) verbSetLength(delay[i], dl[i]);
  verbSetLength(apDelay[0].d, 1800); verbSetLength(apDelay[1].d, 2039);
  verbModSetLength(apModDelay[0].d, 672); verbModSetLength(apModDelay[1].d, 908);
  const double gs[4] = {0.75, 0.75, 0.625, 0.625}; for (int i = 0; i < 4; i++) inputAllpass[i].g = gs[i];
  parameter[0] = 0.3f; parameter[1] = 0.6f; parameter[2] = 0.5f; parameter[3] = 0.5f;
  for (int i = 0; i < 4; i++) setParameter(i, parameter[i]);
}
void ReverbBus::setParameter(int idx, double v) {
  parameter[idx] = (float)v;
  if (idx == 0) verbSetRoomSize(preDelay, 0.02166 + v * 0.97784342688330871492);
  else if (idx == 1) feedback = v;
  else if (idx == 2) { tiltSetParameter(eq, -1 + 2 * v); tiltSetParameter(eqFb, -1 + 2 * v); tiltSetParameter(eqFbR, -1 + 2 * v); lpFeedback.r = f(v); }
  else if (idx == 3) earlyVolume = v;
}
void ReverbBus::process(int16_t* out, int size) {
  const int16_t* fx = input;
  lfoS[0] = lfoS[0] - lfoA * lfoS[1]; lfoS[1] = lfoS[1] + lfoA * lfoS[0];
  verbModSetValue(apModDelay[1].d, lfoS[0]); verbModSetValue(apModDelay[0].d, lfoS[1]);
  for (int i = 0; i < size; i++) {
    const double mix = jsMax(-32768, jsMin(32767, std::trunc(fx[2 * i] / 2.0) + std::trunc(fx[2 * i + 1] / 2.0)));
    double x = verbProcess(preDelay, mix / 32768);
    verbProcess(early, x);
    const double e = verbReadTap(early, VERB_EARLY[0]) + verbReadTap(early, VERB_EARLY[1]) * 0.5
      + verbReadTap(early, VERB_EARLY[2]) * 0.125 + verbReadTap(early, VERB_EARLY[3]) * 0.25;
    x = 0.5 * tiltProcess(eq, x);
    const double in1 = allpassProcess(inputAllpass[0], allpassProcess(inputAllpass[1], x));
    const double in2 = allpassProcess(inputAllpass[2], allpassProcess(inputAllpass[3], x));
    double t = allpassProcess(apModDelay[0], in1 + lastOut2);
    t = verbProcess(delay[0], t) * feedback;
    t = allpassProcess(apDelay[1], t);
    t = verbProcess(delay[1], t);
    lastOut = calcOnePole(lpFeedback, t * feedback);
    t = allpassProcess(apModDelay[1], in2 + lastOut);
    t = verbProcess(delay[2], t) * feedback;
    t = allpassProcess(apDelay[1], t);
    t = verbProcess(delay[3], t);
    lastOut2 = t * feedback;
    double o2 = verbReadTapSample(delay[2], 266) * 0.6;
    o2 -= verbReadTapSample(apDelay[1].d, 1913) * 0.6;
    o2 += verbReadTapSample(delay[3], 996) * 0.6;
    o2 -= verbReadTapSample(apDelay[0].d, 187) * 0.6;
    o2 -= verbReadTapSample(delay[1], 1066) * 0.6;
    const double o = tiltProcess(eqFb, e * earlyVolume + o2);
    const int wet = (int)jsMax(-32768, jsMin(32767, std::trunc(o * 32768)));
    int wetR = wet;
    if (stereo) {
      const double earlyR = verbReadTap(early, VERB_EARLY_R[0]) * 0.5 + verbReadTap(early, VERB_EARLY_R[1])
        + verbReadTap(early, VERB_EARLY_R[2]) * 0.25 + verbReadTap(early, VERB_EARLY_R[3]) * 0.125;
      double r2 = verbReadTapSample(delay[0], 353) * VERB_R;
      r2 -= verbReadTapSample(apDelay[1].d, 1228) * VERB_R;
      r2 += verbReadTapSample(delay[1], 1375) * VERB_R;
      r2 -= verbReadTapSample(delay[3], 121) * VERB_R;
      wetR = (int)jsMax(-32768, jsMin(32767, std::trunc(tiltProcess(eqFbR, earlyR * earlyVolume + r2) * 32768)));
    }
    out[2 * i] = (int16_t)qadd16(out[2 * i], wet); out[2 * i + 1] = (int16_t)qadd16(out[2 * i + 1], wetR);
  }
}

}  // namespace lxr
