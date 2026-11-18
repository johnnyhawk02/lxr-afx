// METAMORF's wavetables, copied unchanged from johnnyhawk02/metamorf engine/tables.js (Johnny's own code, written
// without any LXR code). Keep it the same as METAMORF's, so a table sounds the same in both apps; a change there is
// copied here whole.

// Wavetables: a table is a run of frames, each one cycle, and POSITION reads between neighbouring frames. Each frame
// is kept in band-limited copies, one per octave: copy l holds the harmonics up to TOP_H >> l (made with an inverse
// FFT from the frame's spectrum), so a note reads a copy with nothing above Nyquist. A note between two octaves
// crossfades the two copies, so a pitch sweep never steps.
//
// The copies are sized for their harmonics, not one size for all: the full-band copy has 4096 harmonics (a note at
// 4 Hz still reaches 16 kHz, so low notes keep their highs). Every copy holds 8 samples per harmonic and is read with
// 6-point Lagrange interpolation: its images (which would alias) stay under -75 dB, its droop under 0.1 dB. A table
// whose frames stop at a few harmonics shares one copy for every octave that holds them all, so it costs little.
//
// The built-in tables are made from maths (Fourier series, or one cycle of a shape drawn finely and measured with an
// FFT), never shipped as samples; each has a stable id and its maker never changes (a change is a new id). User
// tables come from WAV files (app/wav.js) as frames of FRAME samples. Pure JS: it runs in the AudioWorklet, a Worker
// and node. A table is plain data ({ id, name, frames, size, data }), so it can be posted between threads.

export const TOP_H = 4096, LEVELS = 13; // copies hold 4096, 2048, ... 1 harmonics
const G = 5; // (guard samples per frame)
const XF = 0.15; // (a sixth of an octave, two semitones)
export const FRAME = 2048; // (a WAV frame's length, build step 3)
export const copyHarmonics = (l) => TOP_H >> l;
export const copySize = (l) => Math.max(64, 8 * (TOP_H >> l));

// ---- an in-place radix-2 FFT (complex, re and im arrays); sign +1 is the inverse (without the 1/N) ----
function fft(re, im, sign) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const a = sign * 2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const p = i + k, q = p + len / 2, tr = re[q] * cr - im[q] * ci, ti = re[q] * ci + im[q] * cr;
        re[q] = re[p] - tr; im[q] = im[p] - ti; re[p] += tr; im[p] += ti;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}
export { fft };

/**
 * A table from spectra. Each frame's spectrum is { a, b }: Float64Arrays of cosine and sine amounts by harmonic
 * (index 1..; index 0, the DC, is ignored). Every frame is scaled so its full-band copy peaks at 1, and every copy of
 * a frame takes the same scale, so a sweep across octaves doesn't change the level.
 * Returns { id, name, frames, data, size }: data[l] is one Float32Array of frames * (size[l] + G) samples: each frame
 * with two guard samples before it (its last two) and three after (its first three), so reading needs no wrap. The
 * copies for octaves that hold every harmonic the table has are one shared copy.
 */
export function buildTable(id, name, spectra) {
  const F = spectra.length;
  // the table's highest harmonic that matters (over -120 dB of its strongest)
  let top = 1, big = 0;
  for (const { a, b } of spectra) for (let k = 1; k < a.length; k++) big = Math.max(big, Math.hypot(a[k], b[k]));
  for (const { a, b } of spectra) for (let k = a.length - 1; k > top; k--) if (Math.hypot(a[k], b[k]) > big * 1e-6) { top = k; break; }
  let share = 0; while (share < LEVELS - 1 && (TOP_H >> (share + 1)) >= top) share++; // copies 0..share all hold every harmonic
  const size = Array.from({ length: LEVELS }, (_, l) => copySize(Math.max(l, share)));
  const data = []; for (let l = 0; l < LEVELS; l++) data.push(l < share ? null : new Float32Array(F * (size[l] + G)));
  for (let f = 0; f < F; f++) {
    const { a, b } = spectra[f]; let scale = 1;
    for (let l = share; l < LEVELS; l++) {
      const N = size[l], re = new Float64Array(N), im = new Float64Array(N), lim = Math.min(TOP_H >> l, a.length - 1, N / 2 - 1);
      for (let k = 1; k <= lim; k++) { re[k] = a[k] / 2; im[k] = -b[k] / 2; re[N - k] = a[k] / 2; im[N - k] = b[k] / 2; }
      fft(re, im, 1);
      if (l === share) { let m = 0; for (let i = 0; i < N; i++) m = Math.max(m, Math.abs(re[i])); scale = m > 1e-9 ? 1 / m : 1; }
      const d = data[l], o = f * (N + G) + 2;
      for (let i = 0; i < N; i++) d[o + i] = re[i] * scale;
      d[o - 2] = d[o + N - 2]; d[o - 1] = d[o + N - 1]; d[o + N] = d[o]; d[o + N + 1] = d[o + 1]; d[o + N + 2] = d[o + 2];
    }
  }
  for (let l = 0; l < share; l++) data[l] = data[share];
  return { id, name, frames: F, data, size };
}
/** the number of bytes a table holds (shared copies counted once) */
export const tableBytes = (t) => [...new Set(t.data)].reduce((s, d) => s + d.byteLength, 0);

/** a spectrum ({ a, b } up to TOP_H) from one cycle of a shape, drawn at M points (DC dropped) */
export function measure(wave, M = 1 << 16) {
  const re = new Float64Array(M), im = new Float64Array(M);
  for (let i = 0; i < M; i++) re[i] = wave(i / M);
  fft(re, im, -1);
  const a = new Float64Array(TOP_H + 1), b = new Float64Array(TOP_H + 1);
  for (let k = 1; k <= TOP_H; k++) { a[k] = 2 * re[k] / M; b[k] = -2 * im[k] / M; }
  return { a, b };
}
/** a spectrum from one frame of samples (a power of two long: a WAV frame of FRAME), harmonics up to half its length */
export function measureFrame(x) {
  const M = x.length, re = Float64Array.from(x), im = new Float64Array(M); fft(re, im, -1);
  const H = Math.min(TOP_H, M / 2 - 1), a = new Float64Array(H + 1), b = new Float64Array(H + 1);
  for (let k = 1; k <= H; k++) { a[k] = 2 * re[k] / M; b[k] = -2 * im[k] / M; }
  return { a, b };
}

// ---- the shapes of BASIC, as Fourier series (cosine a_k, sine b_k) ----
const spec = (fa, fb) => { const a = new Float64Array(TOP_H + 1), b = new Float64Array(TOP_H + 1); for (let k = 1; k <= TOP_H; k++) { a[k] = fa(k); b[k] = fb(k); } return { a, b }; };
const zero = () => 0;
const SHAPES = {
  sine: () => spec(zero, (k) => (k === 1 ? 1 : 0)),
  triangle: () => spec(zero, (k) => (k % 2 ? 8 / (Math.PI * Math.PI) * (((k - 1) / 2) % 2 ? -1 : 1) / (k * k) : 0)),
  saw: () => spec(zero, (k) => 2 / Math.PI * (k % 2 ? 1 : -1) / k),
  // a pulse of width w (0.5 is the square), high for w of the cycle, without its DC
  pulse: (w) => spec((k) => 2 * Math.sin(Math.PI * k * w) / (Math.PI * k) * Math.cos(Math.PI * k * w), (k) => 2 * Math.sin(Math.PI * k * w) / (Math.PI * k) * Math.sin(Math.PI * k * w)),
};
const mix = (p, q, t) => ({ a: p.a.map((v, k) => v + (q.a[k] - v) * t), b: p.b.map((v, k) => v + (q.b[k] - v) * t) });

const range = (n, f) => Array.from({ length: n }, (_, i) => f(i / (n - 1), i));
const harmonics = (H, amp) => spec((k) => 0, (k) => (k <= H ? amp(k) : 0));
// a seeded generator (xorshift), so a seeded table is the same everywhere, every time
const seeded = (s) => () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
const TAU = 2 * Math.PI;

/** BASIC: sine > triangle > saw > square > narrow pulse, in 41 frames (10 between each pair of shapes) */
function basicSpectra() {
  const keys = [SHAPES.sine(), SHAPES.triangle(), SHAPES.saw(), SHAPES.pulse(0.5)], frames = [];
  for (let s = 0; s < 3; s++) for (let i = 0; i < 10; i++) frames.push(mix(keys[s], keys[s + 1], i / 10));
  for (let i = 0; i <= 10; i++) frames.push(SHAPES.pulse(0.5 - 0.45 * i / 10)); // the square narrowing to a 5% pulse
  return frames;
}

// The built-in tables: [id, name, maker of the frames' spectra]. The ids never change; a changed maker is a new id.
export const BUILTINS = [
  ['builtin:basic', 'BASIC', basicSpectra],
  // a sine, then harmonics added one at a time (falling gently, as 1/k^0.7), up to 32
  ['builtin:harmonics', 'HARMONICS', () => range(32, (t, i) => harmonics(i + 1, (k) => Math.pow(k, -0.7)))],
  // odd harmonics building up (hollow, woody), up to the 63rd
  ['builtin:odd', 'ODD', () => range(32, (t, i) => harmonics(2 * i + 1, (k) => (k % 2 ? 1 / k : 0)))],
  // a pulse narrowing from 50% to 2%
  ['builtin:pulse', 'PULSE', () => range(33, (t) => SHAPES.pulse(0.5 - 0.48 * t))],
  // hard sync: a sine restarted every cycle at ratios rising from 1 to 8 (its frequency as a smooth curve, so the
  // sweep is even in pitch), measured with every harmonic up to TOP_H
  ['builtin:sync', 'SYNC', () => range(33, (t) => { const r = Math.pow(8, t); return measure((x) => Math.sin(TAU * r * x)); })],
  // a sine folded back on itself as its gain rises from 1 to 8 (a triangle fold: smooth corners, no clipping)
  ['builtin:fold', 'FOLD', () => range(33, (t) => { const g = 1 + 7 * t; return measure((x) => { const v = g * Math.sin(TAU * x), u = (v + 1) / 4; return 1 - 4 * Math.abs(u - Math.floor(u + 0.5)); }); })],
  // phase distortion: a cosine whose first half-cycle is squeezed into a shorter and shorter part of the cycle, a
  // resonant peak forming
  ['builtin:bend', 'BEND', () => range(33, (t) => { const d = 0.5 - 0.47 * t; return measure((x) => -Math.cos(Math.PI * (x < d ? x / d : 1 + (x - d) / (1 - d)))); })],
  // a harmonic spectrum (1/sqrt k) with a peak sweeping up through it, from the 1st harmonic to the 48th
  ['builtin:formant', 'FORMANT', () => range(33, (t) => { const c = 1 + 47 * t, w = 1.5 + 3 * t; return harmonics(64, (k) => Math.pow(k, -0.5) * (0.15 + Math.exp(-(((k - c) / w) ** 2)))); })],
  // a few high harmonics, seeded, a new set every frame (bells and metal, especially with FM)
  ['builtin:sparse', 'SPARSE', () => { const rnd = seeded(91); return range(33, (t) => { const o = spec(() => 0, () => 0); o.b[1] = 0.5; for (let n = 0; n < 4; n++) { const k = 2 + Math.floor(rnd() * (6 + 50 * t)); o.b[k] += 0.3 + 0.7 * rnd(); } return o; }); }],
  // seeded random spectra, from smooth (falling fast, little jitter) to rough (flat, every harmonic random)
  ['builtin:grit', 'GRIT', () => { const rnd = seeded(23), ph = Array.from({ length: TOP_H + 1 }, () => rnd() * TAU), j = Array.from({ length: TOP_H + 1 }, () => rnd());
    return range(33, (t) => { const p = 2 - 1.5 * t; return spec((k) => Math.pow(k, -p) * (1 - t + 2 * t * j[k]) * Math.cos(ph[k]), (k) => Math.pow(k, -p) * (1 - t + 2 * t * j[k]) * Math.sin(ph[k])); }); }],
  // a sine quantised to fewer and fewer steps, from 64 levels to 2 (the step size changing smoothly, so every frame
  // differs)
  ['builtin:steps', 'STEPS', () => range(33, (t) => { const n = Math.pow(2, 6 - 5 * t); return measure((x) => Math.round(Math.sin(TAU * x) * n) / n); })],
];
export const BUILTIN_IDS = BUILTINS.map((b) => b[0]);
export const DEFAULT_TABLE = 'builtin:basic';

/** build a built-in table (about 0.05 to 0.3 s each) */
export function builtin(id) { const b = BUILTINS.find((x) => x[0] === id); return b ? buildTable(b[0], b[1], b[2]()) : null; }
/** BASIC, built (kept for the tests) */
export const basic = () => builtin('builtin:basic');

/** a user table from frames of samples (each a power of two long; app/wav.js gives FRAME) */
export const fromFrames = (id, name, frames) => buildTable(id, name, frames.map(measureFrame));

// the tables this thread holds, by id. BASIC is always there (the fallback for a table not here yet, or missing)
const HELD = new Map();
export function table(id) { let t = HELD.get(id); if (t) return t; if (id === DEFAULT_TABLE || !id) { t = basic(); HELD.set(DEFAULT_TABLE, t); return t; } return null; }
export const hold = (t) => { HELD.set(t.id, t); };
export const holds = (id) => HELD.has(id);
export const drop = (id) => { if (id !== DEFAULT_TABLE) HELD.delete(id); };
/** a built-in table, built here if this thread doesn't hold it yet */
export function need(id) { if (!HELD.has(id)) { const t = builtin(id); if (t) HELD.set(id, t); } return table(id); }
/** the old name (build step 2): BASIC */
export const tables = () => table(DEFAULT_TABLE);

// 6-point Lagrange interpolation between d[o] and d[o + 1] (the samples at -2..3 around o), at fraction f: the
// weights for f first (weights(f)), then the sum (lagrange(d, o))
const W = new Float64Array(6);
function weights(f) {
  const a = f + 2, b = f + 1, c = f, d = f - 1, e = f - 2, g = f - 3, cd = c * d, ab = a * b, eg = e * g;
  W[0] = -b * cd * eg / 120; W[1] = a * cd * eg / 24; W[2] = -ab * d * eg / 12; W[3] = ab * c * eg / 12; W[4] = -ab * cd * g / 24; W[5] = ab * cd * e / 120;
}
const lagrange = (d, o) => W[0] * d[o - 2] + W[1] * d[o - 1] + W[2] * d[o] + W[3] * d[o + 1] + W[4] * d[o + 2] + W[5] * d[o + 3];

/**
 * Read table t at position pos (0..1), phase (0..1), for a note of hz at sample rate fs: frames interpolated by
 * position, samples by phase, octave copies crossfaded by pitch.
 */
export function read(t, pos, phase, hz, fs) {
  // copy n (n = log2(TOP_H * hz / (fs / 2))) would put its top harmonic at Nyquist; read the one above it (its top
  // harmonic between a quarter of the sample rate and Nyquist, so nothing passes Nyquist). Over the last XF of each
  // octave it crossfades to the next copy, so the change of copy never steps; until then the note keeps every harmonic
  // the copy has
  const n = Math.log2(TOP_H * 2 * hz / fs);
  let l0, w;
  if (n < -1) { l0 = 0; w = 0; } else { const fl = Math.floor(n), fr = n - fl; l0 = fl + 1; w = fr > 1 - XF ? (fr - 1 + XF) / XF : 0; }
  if (l0 >= LEVELS - 1) { l0 = LEVELS - 1; w = 0; }
  const F = t.frames, fp = Math.min(Math.max(pos, 0), 1) * (F - 1), f0 = F > 1 ? Math.min(fp | 0, F - 2) : 0, ff = F > 1 ? fp - f0 : 0;
  const at = (l) => {
    const N = t.size[l], d = t.data[l], x = phase * N < N ? phase * N : 0, i0 = x | 0, /* (a phase of -1e-17 wrapped is 1.0: read it as 0) */ o0 = f0 * (N + G) + 2 + i0, o1 = o0 + (F > 1 ? N + G : 0);
    weights(x - i0);
    const s0 = lagrange(d, o0), s1 = lagrange(d, o1); return s0 + (s1 - s0) * ff;
  };
  const y = at(l0);
  return w > 0 ? y + (at(l0 + 1) - y) * w : y;
}
