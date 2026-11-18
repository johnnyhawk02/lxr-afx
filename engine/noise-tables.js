// LXR-AFX's own wavetables (not METAMORF's): noise, as tables. A table here plays a cycle of STEPS random steps, read at
// the key's pitch divided by STEPS (the table's div), so the steps come at the key's pitch, as the firmware's noise
// takes a new random level once a cycle. The cycle then loops: a digital, looping noise (Johnny, 2026-11-18).
// Each maker returns frames of samples (LEN long), measured into spectra by wavetables.js buildTable.
export const STEPS = 256;
const LEN = 8192, PER = LEN / STEPS; // (32 samples a step: harmonics up to 16 times the step rate)
const seeded = (s) => () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
const frame = (fn) => { const x = new Float64Array(LEN); for (let i = 0; i < LEN; i++) x[i] = fn(Math.floor(i / PER), (i % PER) / PER, i); return x; };
const ramp = (a, b, n) => Array.from({ length: n }, (_, i) => a * Math.pow(b / a, i / (n - 1)));

// NOISE, 41 frames, from clean to wild:
//   0-10  a sine at the key's pitch, smooth noise fading in over it
//  10-20  the smooth noise growing harder edges, to stepped noise (20: the firmware's noise)
//  20-30  tuned noise: the steps repeat every L of them, L from 256 to 3, so a pitch (the key's / L) rises out of the hiss
//  30-40  8-bit noise: every step full up or full down, its loop from 256 steps to 7 (metallic, like old game consoles)
function noiseFrames() {
  const rnd = seeded(77), v = Array.from({ length: STEPS }, () => rnd() * 2 - 1), out = [];
  const smooth = (k, u, hard) => { const e = Math.min(1, Math.max(0, (u - 0.5) / Math.max(1 - hard, 1e-6) + 0.5)), w = (1 - Math.cos(Math.PI * e)) / 2; return v[k] + (v[(k + 1) % STEPS] - v[k]) * w; };
  for (let i = 0; i <= 10; i++) { const t = i / 10; out.push(frame((k, u) => (1 - t) * Math.sin(2 * Math.PI * u) + t * smooth(k, u, 0))); }
  for (let i = 1; i <= 10; i++) { const h = i / 10; out.push(frame((k, u) => smooth(k, u, h))); }
  for (const L of ramp(256, 3, 11).slice(1).map(Math.round)) out.push(frame((k) => v[k % L]));
  for (const L of ramp(256, 7, 10).map(Math.round)) out.push(frame((k) => (v[k % L] >= 0 ? 1 : -1)));
  return out;
}
// DUST, 33 frames: silence and random clicks, from 1 click a cycle to 128 (a click: a short ringing spike)
function dustFrames() {
  const rnd = seeded(5), at = Array.from({ length: 128 }, () => Math.floor(rnd() * LEN)), amp = Array.from({ length: 128 }, () => (rnd() < 0.5 ? -1 : 1) * (0.4 + 0.6 * rnd()));
  return Array.from({ length: 33 }, (_, f) => {
    const n = Math.round(Math.pow(128, f / 32)), x = new Float64Array(LEN);
    for (let c = 0; c < n; c++) for (let j = 0; j < 12; j++) x[(at[c] + j) % LEN] += amp[c] * Math.pow(-0.7, j); // (a click: a short ringing spike)
    return x;
  });
}
// [id, name, maker of the frames, div, how much of the cycle the OSC heading's picture shows]
export const NOISE_TABLES = [
  ['lxr:noise', 'NOISE', noiseFrames, STEPS, 6 / STEPS],
  ['lxr:dust', 'DUST', dustFrames, STEPS, 1],
];
