// sound/instrument.js, sound/dirt.js and makers.js blend(), ported line by line. Float32Array stores round to float
// (the float members and buffers here), as they do in JS.
#include "Instrument.h"

#include <algorithm>
#include <cmath>
#include <cstring>

#include "../gen/LxrData.h"
#include "Js.h"

namespace lxr {
using namespace lxr::data;

namespace {
constexpr double PI = 3.141592653589793;
inline double db(double d) { return std::pow(10.0, d / 20); }
inline double dirtHz(double v) { return 20 * std::pow(1000.0, v / 127); }
inline double volDb(double v) { return v != 0 ? -40 + 48 * (v - 1) / 126 : -INFINITY; }
inline double pregainDb(double v) { return v - 24; }
inline double gainDb(double v) { return v / 127 * 40; }
inline double bassDb(double v) { return v - 12; }
inline double logcosh(double x) { const double a = x < 0 ? -x : x; return a + std::log1p(std::exp(-2 * a)) - 0.6931471805599453; }
inline double onePole(double hz, double fs) { return 1 - std::exp(-2 * PI * hz / fs); }
inline void svfCoef(double hz, double fs, double k, double* o) {
  const double g = std::tan(PI * jsMin(hz, fs * 0.45) / fs), a1 = 1 / (1 + g * (g + k));
  o[0] = a1; o[1] = g * a1; o[2] = g * g * a1;
}
inline double soft(double x) {
  return x > 0.9 ? 0.9 + 0.1 * std::tanh((x - 0.9) * 10) : x < -0.9 ? -0.9 - 0.1 * std::tanh((-x - 0.9) * 10) : x;
}
inline double num(const json& o, const char* k, double def) {
  auto it = o.find(k);
  if (it == o.end() || it->is_null()) return def;
  if (it->is_number()) return it->get<double>();
  if (it->is_boolean()) return it->get<bool>() ? 1 : 0;
  return def;
}
inline bool has(const json& o, const char* k) { return o.is_object() && o.contains(k) && !o[k].is_null(); }
inline double echoMs(double v) { return jsRound(10 * std::pow(200.0, v / 127)); }
const char* const DIRT_KEYS[Dirt::NUM_P] = {"on", "pregain", "cutoff", "swap", "xover", "gain", "clip", "bass", "tone", "dirty", "clean"};
// dirt.js's cur, in its order, as indexes of p
const int GLIDE_KEYS[7] = {Dirt::PREGAIN, Dirt::CUTOFF, Dirt::GAIN, Dirt::TONE, Dirt::BASS, Dirt::DIRTY, Dirt::CLEAN};
}  // namespace

// ---------------------------------------------------------------------------------------------------------------
// sound/dirt.js
// ---------------------------------------------------------------------------------------------------------------
double Dirt::Clip::run(double x, double t, double b) {
  const double u = x / t + b, d = u - u1;
  const double y = std::fabs(d) < 1e-5 ? std::tanh((u + u1) / 2) : (logcosh(u) - logcosh(u1)) / d;
  u1 = u;
  return t * (y - std::tanh(b));
}
Dirt::Dirt(double fs_) : fs(fs_) {
  const double defs[NUM_P] = {0, 24, 25, 0, 0, 64, 0, 12, 64, 85, 0};
  std::memcpy(p, defs, sizeof(p));
  const double c[7] = {24, 25, 64, 64, 12, 85, 0};
  std::memcpy(cur, c, sizeof(cur));
  glide = 1 - std::exp(-1 / (0.01 * fs));
  k = std::sqrt(2.0); co[0] = co[1] = co[2] = 0;
  aDc = onePole(8, fs); aLp = onePole(400, fs); aHp = onePole(1200, fs); aLow = onePole(110, fs);
}
void Dirt::set(const json& s) {
  if (!s.is_object()) return;
  for (int i = 0; i < NUM_P; i++) if (has(s, DIRT_KEYS[i])) p[i] = num(s, DIRT_KEYS[i], p[i]);
}
void Dirt::process(float* L, float* R, int n) {
  const double gl = glide;
  const double wetTo = p[ON] != 0 ? 1 : 0; const bool diode = p[CLIP] == 0;
  const double t1 = diode ? 0.32 : 0.85, t2 = diode ? 0.4 : 1.0, b1 = diode ? 0.18 : 0.08, make = diode ? 1.7 : 0.9;
  for (int i = 0; i < n; i++) {
    for (int j = 0; j < 7; j++) cur[j] += (p[GLIDE_KEYS[j]] - cur[j]) * gl;
    wet += (wetTo - wet) * gl;
    const double cPre = cur[0], cCut = cur[1], cGain = cur[2], cTone = cur[3], cBass = cur[4], cDirty = cur[5], cClean = cur[6];
    const double gPre = db(pregainDb(cPre)), gIn = db(gainDb(cGain)), inter = 1 + 3 * cGain / 127;
    const double gDirty = cDirty < 0.5 ? 0 : db(volDb(cDirty)) * make, gClean = cClean < 0.5 ? 0 : db(volDb(cClean));
    const double tt = cTone / 127, norm = 1 / jsMax(tt, 1 - tt), gBass = db(bassDb(cBass)) - 1;
    svfCoef(dirtHz(cCut), fs, k, co);
    const double w = wet;
    for (int c = 0; c < 2; c++) {
      float* X = c ? R : L; const double x = X[i]; Channel& h = ch[c];
      const double xp = x * gPre;
      { Svf& s = h.filt; const double v3 = xp - s.s2, v1 = co[0] * s.s1 + co[1] * v3, v2 = s.s2 + co[1] * s.s1 + co[2] * v3;
        s.s1 = 2 * v1 - s.s1; s.s2 = 2 * v2 - s.s2; s.lp = v2; s.bp = v1; s.hp = xp - k * v1 - v2; }
      const double into = p[SWAP] != 0 ? h.filt.lp : h.filt.hp;
      const double clean = (p[XOVER] != 0 ? x - into / gPre : x) * gClean;
      double y = h.c1.run(into * gIn, t1, b1);
      y = h.c2.run(y * inter, t2, 0.04);
      h.dc += (y - h.dc) * aDc; y -= h.dc;
      h.lp += (y - h.lp) * aLp; h.low += (h.lp - h.low) * aLow;
      h.hpX += (y - h.hpX) * aHp; const double hp = y - h.hpX;
      const double lo = h.lp + gBass * h.low;
      const double dirty = ((1 - tt) * lo + tt * hp) * norm * gDirty;
      X[i] = (float)(x + (dirty + clean - x) * w);
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// sound/instrument.js
// ---------------------------------------------------------------------------------------------------------------
Instrument::Instrument(double sampleRate) : dirt(REAL_FS) {
  e.loadInitKit();
  ratio = REAL_FS / sampleRate;
  for (int i = 0; i < 6; i++) { trim[i] = 1; trimNow[i] = 1; seqPat[i] = 0b00010001; }
  echo.delay.type = 0;  // (fxType FX_DELAY, forceWet: the bus is an echo, all wet)
  verb.stereo = true;
  duckA = std::exp(-1 / (0.002 * REAL_FS)); duckR = std::exp(-1 / (0.1 * REAL_FS));
  for (auto& g : duckG) g = 1;
  cur.assign(ALL_PARAMS, NAN);
  setFx(json::parse(FX_DEFAULTS_JSON));
  block(A[0], A[1]); block(B[0], B[1]);
}

const Wavetable* Instrument::tableFor(double value) const {
  const double r = jsRound(value);
  if (!(r >= 0 && r < NUM_TABLE_IDS)) return nullptr;
  return builtinIfMade(TABLE_BUILTIN[(int)r]);
}
void Instrument::retable() { for (int v = 0; v < 6; v++) e.setTable(v, tableFor(tableOf[v])); }

void Instrument::setEngines(int n) {
  n = std::max(1, std::min(MAX_ENGINES, n));
  bool on[6] = {};
  for (int i = 0; i < 6; i++) { if (i < n) on[SOUND_ENGINE_VOICE[i]] = true; else { held[i].on = false; backs[i].on = false; } }
  e.onlyAll = false;
  for (int v = 0; v < 6; v++) e.only[v] = on[v];
}

void Instrument::loadKit(const std::vector<double>& values) {
  for (auto& g : glides) g.on = false;
  e.loadKit(values.data(), (int)values.size());
  for (int p = SEND_BASE; p < std::min((int)values.size(), ALL_PARAMS); p++) set(p, values[p]);
  for (int p = 0; p < std::min((int)values.size(), SEND_BASE); p++) cur[p] = values[p];
}

void Instrument::setParam(int par, double value) {
  for (auto& g : glides) {
    if (!g.on) continue;
    for (size_t i = 0; i < g.pars.size(); i++) if (g.pars[i] == par) { g.pars.erase(g.pars.begin() + i); g.a.erase(g.a.begin() + i); g.b.erase(g.b.begin() + i); break; }
  }
  set(par, value);
}

void Instrument::set(int par, double value) {
  if (par < 0) return;
  if (par < ALL_PARAMS) cur[par] = value;
  if (par >= STEPLEN_BASE) { if (par < ALL_PARAMS) e.setStepLen(par - STEPLEN_BASE, value); return; }
  if (par >= STEP2_BASE) { const int i = par - STEP2_BASE; e.setStep(i >> 3, 8 + (i & 7), value / 127); return; }
  if (par >= STEPX_BASE) {
    const int i = par - STEPX_BASE;
    if (i % 2) e.setStepSlew(i >> 1, value); else e.setStepTime(i >> 1, value);
    return;
  }
  if (par >= STEP_BASE) { const int i = par - STEP_BASE; e.setStep(i >> 3, i & 7, value / 127); return; }
  if (par >= DEPTH_BASE) {
    const Route& r = ROUTES[par - DEPTH_BASE]; if (r.voice < 0 || r.dest < 0) return;
    e.setRouteAmt(r.voice, r.dest, r.src, (value - MOD_AMT_ZERO) / 127);
    return;
  }
  if (par >= TABLE_BASE) {
    const int v = par - TABLE_BASE; if (v >= 6) return;
    tableOf[v] = value; e.setTable(v, tableFor(value));
    return;
  }
  if (par >= MOD_BASE) return;
  if (par >= EXTRA_BASE) {
    if (EXTRA_LIVE[par]) { const int i = par - EXTRA_BASE, n = i / NUM_EXTRAS, k = i % NUM_EXTRAS; if (e.voices[n].extra[k] != value) e.setExtra(n, k, value); }
    return;
  }
  if (par >= TRIM_BASE) { if (par < ALL_PARAMS) trim[par - TRIM_BASE] = (float)std::pow(10.0, (value - TRIM_ZERO) * TRIM_STEP_DB / 20); return; }
  if (par >= SEQ_PAT_BASE) { seqPat[par - SEQ_PAT_BASE] = st8(value); return; }
  if (par >= SEQ_ON_BASE) { seqOn[par - SEQ_ON_BASE] = value != 0 ? 1 : 0; return; }
  if (par >= REPEAT_BASE) return;
  if (par >= SEND_BASE) { const int i = par - SEND_BASE; if (i % 3 < 2) sends[i % 3][i / 3] = (float)(value / 127); return; }
  if (par < (int)e.activeParameters.size() && e.activeParameters[par] != value) e.setParam(par, value);
}

void Instrument::setBpm(double b) { bpm = jsMax(20, jsMin(300, b)); e.stepBpm = bpm; }

void Instrument::setFx(const json& fx) {
  if (!fx.is_object()) return;
  if (has(fx, "tempo")) {
    const json& t = fx["tempo"];
    setBpm(num(t, "bpm", NAN));
    if (has(t, "ret")) retQ = (int)num(t, "ret", 2);
    if (has(t, "morph")) { const double mo = num(t, "morph", 0); morphMs = jsMax(0, mo == mo ? mo : 0); }
  }
  if (has(fx, "echo")) {
    const json& ec = fx["echo"];
    echo.delay.type = num(ec, "pingpong", 0) != 0 ? 1 : 0;
    const double vals[4] = {0.5, 0.5, num(ec, "tone", NAN) / 127, num(ec, "feedback", NAN) / 127};
    for (int i = 0; i < 4; i++) echo.setParameter(i, vals[i]);
    double secs;
    if (num(ec, "sync", 0) != 0) {
      const double div = num(ec, "div", NAN);
      const int di = div == div && div >= 0 && div < 12 && div == std::floor(div) ? (int)div : 7;
      secs = ECHO_DIV_BEATS[di] * 60 / bpm;
    } else secs = echoMs(num(ec, "time", NAN)) / 1000;
    echo.setDelaySync(secs * REAL_FS);
    ret[0] = 1;
    duck = num(ec, "duck", 0) / 127;
  }
  if (has(fx, "reverb")) {
    const json& r = fx["reverb"];
    const char* keys[4] = {"size", "decay", "tone", "early"};
    for (int i = 0; i < 4; i++) verb.setParameter(i, num(r, keys[i], NAN) / 127);
    ret[1] = 1; verbPost = num(r, "post", 0) != 0;
  }
  if (has(fx, "dirt")) dirt.set(fx["dirt"]);
  if (has(fx, "master")) {
    const json& ms = fx["master"];
    m.thresh = num(ms, "thresh", m.thresh); m.ratio = num(ms, "ratio", m.ratio); m.attack = num(ms, "attack", m.attack);
    m.release = num(ms, "release", m.release); m.knee = num(ms, "knee", m.knee); m.makeup = num(ms, "makeup", m.makeup); m.level = num(ms, "level", m.level);
  }
  if (has(fx, "macros")) setMacros(fx["macros"]);
}

void Instrument::setMacros(const json& mc) {
  if (!mc.is_object()) return;
  if (mc.contains("t") && mc["t"].is_array()) {
    const json& t = mc["t"];
    for (int k = 0; k < NUM_MACROS; k++) {
      macroT[k].clear();
      if (k >= (int)t.size() || !t[k].is_array()) continue;
      for (const json& x : t[k]) {
        if (!x.is_array() || x.size() < 2 || !x[0].is_string()) continue;
        const std::string u = x[0].get<std::string>(); int i = -1;
        for (int j = 0; j < NUM_MOD; j++) if (u == MOD_DIALS[j]) { i = j; break; }
        const double d = x[1].is_number() ? x[1].get<double>() : 0;
        if (i >= 0 && d == d && d != 0) macroT[k].push_back({i, d});
      }
    }
  }
  if (!macroHost && mc.contains("v") && mc["v"].is_array()) {
    const json& v = mc["v"];
    for (int k = 0; k < NUM_MACROS; k++) { const double x = k < (int)v.size() && v[k].is_number() ? v[k].get<double>() : 0; macroV[k] = x == x ? jsMax(0, jsMin(127, x)) : 0; }
  }
  if (mc.contains("slew")) {
    double ms = mc["slew"].is_number() ? mc["slew"].get<double>() : 0; ms = ms == ms ? jsMax(0, ms) : 0;
    macroCoef = ms > 0 ? std::exp(-BLOCK / (ms / 1000 * REAL_FS)) : 0;
  }
  if (macroCoef == 0) for (int k = 0; k < NUM_MACROS; k++) macroCur[k] = macroV[k];
  macros();
}

void Instrument::setMacro(int k, double v) {
  v = v == v ? jsMax(0, jsMin(127, v)) : 0;
  if (k < 0 || k >= NUM_MACROS || macroV[k] == v) return;
  macroV[k] = v; if (macroCoef != 0) return;  // (the blocks glide it there)
  macroCur[k] = v; macros();
}

// sound/instrument.js _macros: every engine voice's knobs moved by the macros
void Instrument::macros() {
  double amt[NUM_MOD] = {};
  for (int k = 0; k < NUM_MACROS; k++) { const double x = macroCur[k] / 127; if (x != 0) for (auto& td : macroT[k]) amt[td.first] += x * td.second / 100; }
  for (int v = 0; v < 6; v++) for (int i = 0; i < NUM_MOD; i++) {
    const Route& r = ROUTES[(v * NUM_MOD + i) * NUM_SRC];
    const int dest = r.voice >= 0 ? r.dest : -1;
    if (dest < 0 || dest >= (int)e.routeIndex[v].size()) continue;
    if (amt[i] == 0 && e.routeIndex[v][dest] < 0) continue;
    e.setRouteAmt(v, dest, SRC_MACRO, amt[i]);
  }
}

void Instrument::play(int sound, double note, double velocity, const Params* params, bool hold, bool glide) {
  glides[sound].on = false;
  if (params && glide && morphMs > 0) glideTo(sound, *params);
  else if (params) for (auto& pv : *params) set(pv.first, pv.second);
  const double vel = jsMax(1, jsMin(127, (double)jsI32(velocity)));
  const int v = SOUND_ENGINE_VOICE[sound];
  backs[sound].on = false;
  if (hold && seqOn[v]) { Held& h = held[sound]; h.on = true; h.note = note; h.vel = vel; h.at = std::ceil(beat * 4 - 1e-6) / 4; h.step = 0; h.cur = -1; return; }
  held[sound].on = false;
  hit(sound, vel, note);
}

void Instrument::glideTo(int sound, const Params& params) {
  Glide& g = glides[sound];
  g.pars.clear(); g.a.clear(); g.b.clear();
  for (auto& pv : params) {
    const int p = pv.first; const double v = pv.second;
    const double x = p < ALL_PARAMS ? cur[p] : NAN;
    if (x != x || x == v) set(p, v);
    else {
      bool found = false;
      for (size_t i = 0; i < g.pars.size(); i++) if (g.pars[i] == p) { g.a[i] = x; g.b[i] = v; found = true; break; }
      if (!found) { g.pars.push_back(p); g.a.push_back(x); g.b.push_back(v); }
    }
  }
  if (g.pars.empty()) return;
  g.on = true; g.t = 0; g.dt = (double)BLOCK / REAL_FS * 1000 / morphMs; g.voice = SOUND_ENGINE_VOICE[sound];
  stepGlide(g);
}

// makers.js blend({ schema, a, b, t }): knobs slide (two decimals), menus and targets flip halfway, a part off on one
// side takes the other side's settings
void Instrument::stepGlide(Glide& g) {
  const SchemaEntry* sc = SCHEMAS[g.voice]; const int n = SCHEMA_LEN[g.voice];
  auto entry = [&](int par) -> const SchemaEntry* { for (int i = 0; i < n; i++) if (sc[i].par == par) return &sc[i]; return nullptr; };
  auto find = [&](int par) -> int { for (size_t i = 0; i < g.pars.size(); i++) if (g.pars[i] == par) return (int)i; return -1; };
  const double t = g.t;
  // the gates: a part's controls follow the side its gate is on (later gates win, as in a Map)
  std::vector<std::pair<int, int>> side;  // (par, 0 a / 1 b)
  const int* gt = GATES[g.voice]; const int glen = GATES_LEN[g.voice];
  for (int i = 0; i < glen;) {
    const int gate = gt[i];
    int j = i + 1; while (j < glen && gt[j] != -1) j++;
    const int gi = find(gate);
    if (gi >= 0) {
      const bool x = g.a[gi] > 0, y = g.b[gi] > 0;
      if (x != y) for (int q = i + 1; q < j; q++) {
        bool done = false;
        for (auto& s : side) if (s.first == gt[q]) { s.second = x ? 0 : 1; done = true; }
        if (!done) side.push_back({gt[q], x ? 0 : 1});
      }
    }
    i = j + 1;
  }
  for (size_t i = 0; i < g.pars.size(); i++) {
    const int p = g.pars[i]; const double x = g.a[i], y = g.b[i];
    int from = -1; for (auto& s : side) if (s.first == p) from = s.second;
    double v;
    if (from >= 0) v = from ? y : x;
    else {
      const SchemaEntry* en = entry(p);
      if (en && en->knob) { const double d2 = jsRound((x + t * (y - x)) * 100) / 100; v = d2 < 0 ? 0 : d2 > en->max ? en->max : d2; }
      else v = t < 0.5 ? x : y;
    }
    set(p, v);
  }
}

void Instrument::hit(int sound, double vel, double note) {
  e.trigger(SOUND_TRIGGER[sound], jsI32(vel), jsI32(note));
  const int v = SOUND_ENGINE_VOICE[sound];
  trimNow[v] = trim[v];
}

void Instrument::back(int sound, double note, double vel, const Params* params, bool glide) {
  held[sound].on = false;
  const int divs[5] = {0, 8, 4, 2, 1};
  const int div = retQ >= 0 && retQ < 5 ? divs[retQ] : 0;
  if (!div) { play(sound, note, vel, params, true, glide); return; }
  Back& b = backs[sound];
  b.on = true; b.at = std::ceil(beat * div - 1e-6) / div; b.note = note; b.vel = vel; b.params = params ? *params : Params{}; b.glide = glide;
}

void Instrument::block(float* L, float* R) {
  const double step = BLOCK * bpm / 60 / REAL_FS;
  for (int s = 0; s < 6; s++) {
    Back& b = backs[s];
    if (b.on && b.at < beat + step) { Params p = std::move(b.params); const double note = b.note, vel = b.vel; const bool gl = b.glide; play(s, note, vel, &p, true, gl); }
  }
  for (int s = 0; s < 6; s++) {
    Glide& g = glides[s]; if (!g.on) continue;
    g.t = jsMin(1, g.t + g.dt); stepGlide(g);
    if (g.t >= 1) g.on = false;
  }
  if (macroCoef != 0) {  // the MACRO knobs' SLEW
    bool moved = false;
    for (int k = 0; k < NUM_MACROS; k++) {
      const double v = macroV[k], c = macroCur[k]; if (c == v) continue;
      const double n = v + (c - v) * macroCoef; macroCur[k] = std::fabs(n - v) < 1e-3 ? v : n; moved = true;
    }
    if (moved) macros();
  }
  for (int s = 0; s < 6; s++) {
    Held& h = held[s]; if (!h.on) continue;
    const int v = SOUND_ENGINE_VOICE[s];
    while (h.at < beat + step) {
      if (seqOn[v] && ((seqPat[v] >> h.step) & 1)) hit(s, h.vel, h.note);
      h.cur = h.step; h.step = (h.step + 1) & 7; h.at += 0.25;
    }
  }
  beat += step;
  e.renderBlock();
  const Voice* pans[6] = {&e.voices[0], &e.voices[1], &e.voices[2], &e.voices[3], &e.voices[4], &e.voices[5]};
  std::fill(L, L + BLOCK, 0.0f); std::fill(R, R + BLOCK, 0.0f);
  for (int n = 0; n < 6; n++) {
    const double t0 = trimNow[n], t1 = trim[n], d = (t1 - t0) / BLOCK; float* t = trimBuf[n];
    for (int i = 0; i < BLOCK; i++) t[i] = (float)(t0 + d * (i + 1));
    trimNow[n] = (float)t1;
  }
  for (int n = 0; n < 6; n++) {
    const int16_t* o = e.out[n]; const float* t = trimBuf[n];
    const double pl = pans[n]->triggeredPanL / 32768 * gain, pr = pans[n]->triggeredPanR / 32768 * gain;
    double pk = peak[n];
    for (int i = 0; i < BLOCK; i++) {
      const double v = o[i] * (double)t[i];
      L[i] = (float)(L[i] + v * pl); R[i] = (float)(R[i] + v * pr);
      const double a = v < 0 ? -v : v; if (a > pk) pk = a;
    }
    peak[n] = (float)pk;
  }
  const double dk = duck;
  if (dk > 0) {
    double en = duckEnv; const double a = duckA, r = duckR;
    for (int i = 0; i < BLOCK; i++) {
      const double x = jsMax(std::fabs((double)L[i]), std::fabs((double)R[i]));
      en = x + (x > en ? a : r) * (en - x);
      duckG[i] = (float)(1 - dk * en / (en + 0.05));
    }
    duckEnv = en;
  } else duckEnv = 0;
  for (int k = 0; k < 2; k++) {
    const float* sd = sends[k]; float* bi = busIn;
    std::fill(bi, bi + BLOCK * 2, 0.0f);
    for (int n = 0; n < 6; n++) {
      const double g = sd[n]; if (g == 0) continue;
      const int16_t* o = e.out[n]; const float* t = trimBuf[n];
      const double pl = pans[n]->triggeredPanL * g, pr = pans[n]->triggeredPanR * g;
      for (int i = 0; i < BLOCK; i++) { const double v = o[i] * (double)t[i]; bi[2 * i] = (float)(bi[2 * i] + v * pl); bi[2 * i + 1] = (float)(bi[2 * i + 1] + v * pr); }
    }
    int16_t* in = k == 0 ? echo.input : verb.input;
    for (int i = 0; i < BLOCK * 2; i++) in[i] = (int16_t)jsMax(-32768, jsMin(32767, jsRound(bi[i])));
    int16_t* bo = busOut; std::fill(bo, bo + BLOCK * 2, (int16_t)0);
    if (k == 0) echo.process(bo, BLOCK); else verb.process(bo, BLOCK);
    const double g = gain * ret[k] / 32768;
    if (g == 0) continue;
    if (k == 0 && dk > 0) for (int i = 0; i < BLOCK; i++) { const double h = g * duckG[i]; L[i] = (float)(L[i] + bo[2 * i] * h); R[i] = (float)(R[i] + bo[2 * i + 1] * h); }
    else if (k == 1 && verbPost) for (int i = 0; i < BLOCK; i++) { postL[i] = (float)(bo[2 * i] * g); postR[i] = (float)(bo[2 * i + 1] * g); }
    else for (int i = 0; i < BLOCK; i++) { L[i] = (float)(L[i] + bo[2 * i] * g); R[i] = (float)(R[i] + bo[2 * i + 1] * g); }
  }
  master(L, R);
  float* o = outPk;
  for (int i = 0; i < BLOCK; i++) {
    const double l = L[i], r = R[i];
    if (l > 1 || l < -1) o[2] = 1;
    if (r > 1 || r < -1) o[3] = 1;
    L[i] = (float)soft(l); R[i] = (float)soft(r);
    const double a = L[i] < 0 ? -L[i] : L[i], b = R[i] < 0 ? -R[i] : R[i];
    if (a > o[0]) o[0] = (float)a;
    if (b > o[1]) o[1] = (float)b;
  }
}

void Instrument::master(float* L, float* R) {
  if (dirt.active()) dirt.process(L, R, BLOCK);
  if (verbPost) { for (int i = 0; i < BLOCK; i++) { L[i] = (float)((double)L[i] + postL[i]); R[i] = (float)((double)R[i] + postR[i]); } std::fill(postL, postL + BLOCK, 0.0f); std::fill(postR, postR + BLOCK, 0.0f); }
  const double T = -m.thresh, rt = jsMax(1, m.ratio / 10), W = m.knee, slope = 1 / rt - 1;
  const double ca = std::exp(-1000 / (jsMax(1, m.attack) * REAL_FS)), cr = std::exp(-1000 / (jsMax(10, m.release) * REAL_FS));
  const double outG = std::pow(10.0, m.makeup / 20) * m.level / 100;
  double en = env, g2 = gr;
  for (int i = 0; i < BLOCK; i++) {
    const double x = 20 * std::log10(jsMax(std::fabs((double)L[i]), std::fabs((double)R[i])) + 1e-9), over = x - T;
    const double want = 2 * over < -W ? 0 : W > 0 && 2 * std::fabs(over) <= W ? slope * std::pow(over + W / 2, 2) / (2 * W) : slope * over;
    en = want + (want < en ? ca : cr) * (en - want);
    const double g = std::pow(10.0, en / 20) * outG;
    L[i] = (float)(L[i] * g); R[i] = (float)(R[i] * g);
    if (-en > g2) g2 = -en;
  }
  env = en; gr = g2;
}

void Instrument::render(float* left, float* right, int n) {
  float (*Ab)[BLOCK] = aIsFirst ? A : B;
  float (*Bb)[BLOCK] = aIsFirst ? B : A;
  for (int k = 0; k < n; k++) {
    while (idx >= BLOCK) {
      aIsFirst = !aIsFirst; std::swap(Ab, Bb);
      block(Bb[0], Bb[1]);
      idx -= BLOCK;
    }
    const int i = idx; const double fr = frac;
    const double l0 = Ab[0][i], r0 = Ab[1][i];
    const double l1 = i < BLOCK - 1 ? Ab[0][i + 1] : Bb[0][0];
    const double r1 = i < BLOCK - 1 ? Ab[1][i + 1] : Bb[1][0];
    left[k] = (float)(l0 + (l1 - l0) * fr);
    right[k] = (float)(r0 + (r1 - r0) * fr);
    frac += ratio;
    const double kk = std::floor(frac);
    idx += (int)kk; frac -= kk;
  }
}

std::vector<double> Instrument::readPeaks() {
  std::vector<double> p(6);
  for (int i = 0; i < 6; i++) { p[i] = peak[i] / 32768.0; peak[i] = 0; }
  return p;
}

}  // namespace lxr
