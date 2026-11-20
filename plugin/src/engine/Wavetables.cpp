// engine/wavetables.js, ported line by line (double maths, as in JS).
#include "Wavetables.h"
#include "Js.h"

#include <atomic>
#include <cmath>
#include <functional>
#include <mutex>

namespace lxr {
namespace {

constexpr double PI = 3.141592653589793;
constexpr double TAU = 2 * PI;
constexpr double XF = 0.15;

inline int copySize(int l) { return std::max(64, 8 * (TOP_H >> l)); }

void fft(std::vector<double>& re, std::vector<double>& im, int sign) {
  const int n = (int)re.size();
  for (int i = 1, j = 0; i < n; i++) {
    int b = n >> 1;
    for (; j & b; b >>= 1) j ^= b;
    j ^= b;
    if (i < j) { std::swap(re[i], re[j]); std::swap(im[i], im[j]); }
  }
  for (int len = 2; len <= n; len <<= 1) {
    const double a = sign * 2 * PI / len, wr = std::cos(a), wi = std::sin(a);
    for (int i = 0; i < n; i += len) {
      double cr = 1, ci = 0;
      for (int k = 0; k < len / 2; k++) {
        const int p = i + k, q = p + len / 2;
        const double tr = re[q] * cr - im[q] * ci, ti = re[q] * ci + im[q] * cr;
        re[q] = re[p] - tr; im[q] = im[p] - ti; re[p] += tr; im[p] += ti;
        const double t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

struct Spec { std::vector<double> a, b; };

std::unique_ptr<Wavetable> buildTable(int index, const std::vector<Spec>& spectra) {
  const int F = (int)spectra.size();
  int top = 1; double big = 0;
  for (auto& s : spectra) for (size_t k = 1; k < s.a.size(); k++) big = jsMax(big, std::hypot(s.a[k], s.b[k]));
  for (auto& s : spectra) for (int k = (int)s.a.size() - 1; k > top; k--) if (std::hypot(s.a[k], s.b[k]) > big * 1e-6) { top = k; break; }
  int share = 0; while (share < LEVELS - 1 && (TOP_H >> (share + 1)) >= top) share++;
  auto t = std::make_unique<Wavetable>();
  t->index = index; t->frames = F;
  std::array<int, LEVELS> size{};
  for (int l = 0; l < LEVELS; l++) size[l] = copySize(std::max(l, share));
  t->store.resize(LEVELS);
  for (int l = share; l < LEVELS; l++) t->store[l].assign((size_t)F * (size[l] + WT_GUARD), 0.0f);
  for (int fr = 0; fr < F; fr++) {
    const auto& a = spectra[fr].a; const auto& b = spectra[fr].b; double scale = 1;
    for (int l = share; l < LEVELS; l++) {
      const int N = size[l];
      std::vector<double> re(N, 0.0), im(N, 0.0);
      const int lim = std::min(std::min(TOP_H >> l, (int)a.size() - 1), N / 2 - 1);
      for (int k = 1; k <= lim; k++) { re[k] = a[k] / 2; im[k] = -b[k] / 2; re[N - k] = a[k] / 2; im[N - k] = b[k] / 2; }
      fft(re, im, 1);
      if (l == share) { double m = 0; for (int i = 0; i < N; i++) m = jsMax(m, std::fabs(re[i])); scale = m > 1e-9 ? 1 / m : 1; }
      float* d = t->store[l].data(); const int o = fr * (N + WT_GUARD) + 2;
      for (int i = 0; i < N; i++) d[o + i] = stf(re[i] * scale);
      d[o - 2] = d[o + N - 2]; d[o - 1] = d[o + N - 1]; d[o + N] = d[o]; d[o + N + 1] = d[o + 1]; d[o + N + 2] = d[o + 2];
    }
  }
  for (int l = 0; l < LEVELS; l++) { t->data[l] = t->store[std::max(l, share)].data(); t->size[l] = size[l]; }
  return t;
}

Spec measure(const std::function<double(double)>& wave, int M = 1 << 16) {
  std::vector<double> re(M), im(M, 0.0);
  for (int i = 0; i < M; i++) re[i] = wave((double)i / M);
  fft(re, im, -1);
  Spec s{std::vector<double>(TOP_H + 1, 0.0), std::vector<double>(TOP_H + 1, 0.0)};
  for (int k = 1; k <= TOP_H; k++) { s.a[k] = 2 * re[k] / M; s.b[k] = -2 * im[k] / M; }
  return s;
}
Spec spec(const std::function<double(int)>& fa, const std::function<double(int)>& fb) {
  Spec s{std::vector<double>(TOP_H + 1, 0.0), std::vector<double>(TOP_H + 1, 0.0)};
  for (int k = 1; k <= TOP_H; k++) { s.a[k] = fa(k); s.b[k] = fb(k); }
  return s;
}
const auto zero = [](int) { return 0.0; };
Spec sine() { return spec(zero, [](int k) { return k == 1 ? 1.0 : 0.0; }); }
Spec triangle() { return spec(zero, [](int k) { return k % 2 ? 8 / (PI * PI) * ((((k - 1) / 2) % 2) ? -1 : 1) / ((double)k * k) : 0.0; }); }
Spec saw() { return spec(zero, [](int k) { return 2 / PI * (k % 2 ? 1 : -1) / k; }); }
Spec pulse(double w) {
  return spec([w](int k) { return 2 * std::sin(PI * k * w) / (PI * k) * std::cos(PI * k * w); },
              [w](int k) { return 2 * std::sin(PI * k * w) / (PI * k) * std::sin(PI * k * w); });
}
Spec mix(const Spec& p, const Spec& q, double t) {
  Spec o = p;
  for (size_t k = 0; k < p.a.size(); k++) { o.a[k] = p.a[k] + (q.a[k] - p.a[k]) * t; o.b[k] = p.b[k] + (q.b[k] - p.b[k]) * t; }
  return o;
}
std::vector<Spec> range(int n, const std::function<Spec(double, int)>& fn) {
  std::vector<Spec> v; v.reserve(n);
  for (int i = 0; i < n; i++) v.push_back(fn((double)i / (n - 1), i));
  return v;
}
Spec harmonics(int H, const std::function<double(int)>& amp) { return spec(zero, [&](int k) { return k <= H ? amp(k) : 0.0; }); }
struct Seeded {
  uint32_t s;
  double operator()() { s ^= s << 13; s ^= s >> 17; s ^= s << 5; return s / 4294967296.0; }
};

std::vector<Spec> basicSpectra() {
  Spec keys[4] = {sine(), triangle(), saw(), pulse(0.5)};
  std::vector<Spec> frames;
  for (int s = 0; s < 3; s++) for (int i = 0; i < 10; i++) frames.push_back(mix(keys[s], keys[s + 1], i / 10.0));
  for (int i = 0; i <= 10; i++) frames.push_back(pulse(0.5 - 0.45 * i / 10));
  return frames;
}

std::vector<Spec> builtinSpectra(int i) {
  switch (i) {
    case 0: return basicSpectra();
    case 1: return range(32, [](double, int i) { return harmonics(i + 1, [](int k) { return std::pow(k, -0.7); }); });
    case 2: return range(32, [](double, int i) { return harmonics(2 * i + 1, [](int k) { return k % 2 ? 1.0 / k : 0.0; }); });
    case 3: return range(33, [](double t, int) { return pulse(0.5 - 0.48 * t); });
    case 4: return range(33, [](double t, int) { const double r = std::pow(8, t); return measure([r](double x) { return std::sin(TAU * r * x); }); });
    case 5: return range(33, [](double t, int) {
      const double g = 1 + 7 * t;
      return measure([g](double x) { const double v = g * std::sin(TAU * x), u = (v + 1) / 4; return 1 - 4 * std::fabs(u - std::floor(u + 0.5)); });
    });
    case 6: return range(33, [](double t, int) {
      const double d = 0.5 - 0.47 * t;
      return measure([d](double x) { return -std::cos(PI * (x < d ? x / d : 1 + (x - d) / (1 - d))); });
    });
    case 7: return range(33, [](double t, int) {
      const double c = 1 + 47 * t, w = 1.5 + 3 * t;
      return harmonics(64, [c, w](int k) { const double z = (k - c) / w; return std::pow(k, -0.5) * (0.15 + std::exp(-(z * z))); });
    });
    case 8: {
      Seeded rnd{91};
      return range(33, [&rnd](double t, int) {
        Spec o = spec(zero, zero); o.b[1] = 0.5;
        for (int n = 0; n < 4; n++) { const int k = 2 + (int)std::floor(rnd() * (6 + 50 * t)); o.b[k] += 0.3 + 0.7 * rnd(); }
        return o;
      });
    }
    case 9: {
      Seeded rnd{23};
      std::vector<double> ph(TOP_H + 1), j(TOP_H + 1);
      for (int k = 0; k <= TOP_H; k++) ph[k] = rnd() * TAU;
      for (int k = 0; k <= TOP_H; k++) j[k] = rnd();
      return range(33, [&](double t, int) {
        const double p = 2 - 1.5 * t;
        return spec([&](int k) { return std::pow(k, -p) * (1 - t + 2 * t * j[k]) * std::cos(ph[k]); },
                    [&](int k) { return std::pow(k, -p) * (1 - t + 2 * t * j[k]) * std::sin(ph[k]); });
      });
    }
    case 10: return range(33, [](double t, int) {
      const double n = std::pow(2, 6 - 5 * t);
      return measure([n](double x) { return jsRound(std::sin(TAU * x) * n) / n; });
    });
    default: return {};
  }
}

constexpr int NUM_BUILTINS = 11;
std::mutex buildLock;
std::unique_ptr<Wavetable> held[NUM_BUILTINS];
std::atomic<const Wavetable*> made[NUM_BUILTINS];

thread_local double W[6];
inline void weights(double fr) {
  const double a = fr + 2, b = fr + 1, c = fr, d = fr - 1, e = fr - 2, g = fr - 3, cd = c * d, ab = a * b, eg = e * g;
  W[0] = -b * cd * eg / 120; W[1] = a * cd * eg / 24; W[2] = -ab * d * eg / 12; W[3] = ab * c * eg / 12; W[4] = -ab * cd * g / 24; W[5] = ab * cd * e / 120;
}
inline double lagrange(const float* d, int o) {
  return W[0] * d[o - 2] + W[1] * d[o - 1] + W[2] * d[o] + W[3] * d[o + 1] + W[4] * d[o + 2] + W[5] * d[o + 3];
}

}  // namespace

int numBuiltins() { return NUM_BUILTINS; }

const Wavetable* builtinIfMade(int i) { return i >= 0 && i < NUM_BUILTINS ? made[i].load(std::memory_order_acquire) : nullptr; }

const Wavetable* builtinTable(int i) {
  if (i < 0 || i >= NUM_BUILTINS) return nullptr;
  if (auto* t = builtinIfMade(i)) return t;
  std::lock_guard<std::mutex> g(buildLock);
  if (!held[i]) { held[i] = buildTable(i, builtinSpectra(i)); made[i].store(held[i].get(), std::memory_order_release); }
  return held[i].get();
}

void buildAllTables() { for (int i = 0; i < NUM_BUILTINS; i++) builtinTable(i); }

double readTable(const Wavetable& t, double pos, double phase, double hz, double fs) {
  const double n = std::log2(TOP_H * 2 * hz / fs);
  int l0; double w;
  if (n < -1) { l0 = 0; w = 0; }
  else { const double fl = std::floor(n), fr = n - fl; l0 = (int)fl + 1; w = fr > 1 - XF ? (fr - 1 + XF) / XF : 0; }
  if (l0 >= LEVELS - 1) { l0 = LEVELS - 1; w = 0; }
  const int F = t.frames;
  const double fp = jsMin(jsMax(pos, 0), 1) * (F - 1);
  const int f0 = F > 1 ? std::min(jsI32(fp), F - 2) : 0;
  const double ff = F > 1 ? fp - f0 : 0;
  auto at = [&](int l) {
    const int N = t.size[l]; const float* d = t.data[l];
    const double x = phase * N < N ? phase * N : 0;
    const int i0 = jsI32(x), o0 = f0 * (N + WT_GUARD) + 2 + i0, o1 = o0 + (F > 1 ? N + WT_GUARD : 0);
    weights(x - i0);
    const double s0 = lagrange(d, o0), s1 = lagrange(d, o1);
    return s0 + (s1 - s0) * ff;
  };
  const double y = at(l0);
  return w > 0 ? y + (at(l0 + 1) - y) * w : y;
}

}  // namespace lxr
