// JavaScript's number semantics, for a line-by-line port of the web app's engine (engine/lxr.js, sound/*.js).
// A JS number is a double; Math.fround is f(); typed-array stores convert the way the typed array does
// (Float32Array rounds to float, Int16Array/Uint8Array wrap modulo 2^16 / 2^8 after truncating). Build with
// -ffp-contract=off and without fast-math: every a*b+c must round twice, as it does in JS.
#pragma once
#include <cmath>
#include <cstdint>
#include <limits>

namespace lxr {

inline double f(double x) { return (double)(float)x; }

// JS ToInt32 / ToUint32 (bit operators, |0, >>>0): truncate, then modulo 2^32
inline int32_t jsI32(double x) {
  if (!std::isfinite(x)) return 0;
  double t = std::trunc(x);
  if (t >= -2147483648.0 && t <= 2147483647.0) return (int32_t)t;
  double m = std::fmod(t, 4294967296.0);
  if (m < 0) m += 4294967296.0;
  return (int32_t)(uint32_t)m;
}
inline uint32_t jsU32(double x) { return (uint32_t)jsI32(x); }
// typed-array stores
inline int16_t st16(double x) { return (int16_t)(uint16_t)jsU32(x); }
inline uint8_t st8(double x) { return (uint8_t)jsU32(x); }
inline int8_t sti8(double x) { return (int8_t)(uint8_t)jsU32(x); }
inline float stf(double x) { return (float)x; }

// Math.round: to the nearest, halves up
inline double jsRound(double x) {
  if (!std::isfinite(x)) return x;
  double r = std::floor(x);
  if (x - r >= 0.5) r += 1;
  return r;
}
inline double jsMin(double a, double b) { if (a != a || b != b) return NAN; return a < b ? a : (a == b && std::signbit(a)) ? a : b; }
inline double jsMax(double a, double b) { if (a != a || b != b) return NAN; return a > b ? a : (a == b && !std::signbit(a)) ? a : b; }

// lxr.js: float/double -> int32 the way the Cortex-M7's VCVT.S32 does it (truncate, saturate, NaN -> 0)
inline int32_t toI32(double x) {
  if (x != x) return 0;
  if (x >= 2147483647.0) return 2147483647;
  if (x <= -2147483648.0) return (int32_t)-2147483648LL;
  return (int32_t)std::trunc(x);
}
inline uint32_t toU32(double x) {
  if (x != x || x <= 0) return 0;
  if (x >= 4294967295.0) return 4294967295u;
  return (uint32_t)std::trunc(x);
}
inline int toI16(double x) { return (int16_t)(uint16_t)(uint32_t)toI32(x); }
inline int toU8(double x) { return (int)(toU32(x) & 0xff); }
inline int ssat16(int x) { return x > 32767 ? 32767 : x < -32768 ? -32768 : x; }
inline double ssat16d(double x) { return x > 32767 ? 32767 : x < -32768 ? -32768 : x; }
inline int qadd16(int a, int b) { return ssat16(a + b); }
inline int qsub16(int a, int b) { return ssat16(a - b); }
inline int wrap16(int x) { return (int16_t)(uint16_t)(uint32_t)x; }

}  // namespace lxr
