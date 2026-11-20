// engine/wavetables.js, ported: METAMORF's built-in wavetables (made from maths) and their band-limited reader.
#pragma once
#include <array>
#include <memory>
#include <vector>

namespace lxr {

constexpr int TOP_H = 4096, LEVELS = 13, WT_GUARD = 5;

struct Wavetable {
  int index = 0;  // which built-in (0 BASIC)
  int frames = 0;
  std::array<const float*, LEVELS> data{};
  std::array<int, LEVELS> size{};
  std::vector<std::vector<float>> store;  // the copies (shared ones once)
};

/** built-in table i (0..10: BUILTINS' order), built on first use; thread-safe */
const Wavetable* builtinTable(int i);
int numBuiltins();
/** build every built-in now (the plugin does this on a background thread) */
void buildAllTables();
/** the built table i if it is made already, else null (never builds) */
const Wavetable* builtinIfMade(int i);

/** wavetables.js read(): table t at position pos (0..1), phase (0..1), for a note of hz at sample rate fs */
double readTable(const Wavetable& t, double pos, double phase, double hz, double fs);

}  // namespace lxr
