// node test/reverb.test.mjs: the reverb in stereo. The engine's ReverbBus is the firmware's (one output, on both
// sides) unless stereo is set; then the left side is still that output, sample for sample, and the right side comes
// from taps of its own: as loud as the left, and unlike it. The instrument switches it on.
import { ReverbBus, BLOCK, REAL_FS } from '../engine/lxr.js';
import { LxrInstrument } from '../sound/instrument.js';
import { sendPar } from '../sound/schema.js';
let fails = 0, checks = 0;
const ok = (c, m) => { checks++; if (!c) { fails++; console.log('FAIL', m); } };

// a signal through the reverb alone (time, feedback, composition, variation: 0..1), its left and right
function run(params, stereo, kind, secs = 3) {
  const v = new ReverbBus(); if (stereo !== undefined) v.stereo = stereo; params.forEach((p, i) => v.setParameter(i, p));
  const n = Math.ceil(secs * REAL_FS / BLOCK), L = new Float32Array(n * BLOCK), R = new Float32Array(n * BLOCK), out = new Int16Array(BLOCK * 2), gap = Math.floor(REAL_FS * 0.25);
  let seed = 12345; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 * 2 - 1; };
  for (let b = 0; b < n; b++) {
    for (let i = 0; i < BLOCK; i++) { const t = b * BLOCK + i;
      const x = kind === 'click' ? (t === 0 ? 30000 : 0) : kind === 'burst' ? (t < REAL_FS * 0.05 ? rnd() * 20000 : 0) : (t % gap < 300 ? rnd() * 20000 * Math.exp(-(t % gap) / 60) : 0); // (or drum-like hits, four a second)
      v.input[2 * i] = x; v.input[2 * i + 1] = x; }
    out.fill(0); v.process(out, BLOCK);
    for (let i = 0; i < BLOCK; i++) { L[b * BLOCK + i] = out[2 * i]; R[b * BLOCK + i] = out[2 * i + 1]; }
  }
  return [L, R];
}
const rms = (a) => { let s = 0; for (const x of a) s += x * x; return Math.sqrt(s / a.length); };
const corr = (a, b) => { let ab = 0, aa = 0, bb = 0; for (let i = 0; i < a.length; i++) { ab += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i]; } return ab / Math.sqrt(aa * bb + 1e-9); };
const same = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };
const dB = (x) => 20 * Math.log10(x + 1e-9);

const SETTINGS = { 'as it comes': [70 / 127, 90 / 127, 64 / 127, 64 / 127], 'the engine\'s own': [0.3, 0.6, 0.5, 0.5], 'short, dark, early': [0, 0.2, 0.1, 1], 'middle': [0.5, 0.5, 0.5, 0.5],
  'long, early full': [0.6, 0.95, 0.7, 1], 'no early reflections': [0.4, 0.8, 0.5, 0], 'early reflections alone': [0.4, 0, 0.5, 1] };
for (const [name, p] of Object.entries(SETTINGS)) for (const kind of ['click', 'burst', 'hits']) {
  const [fL, fR] = run(p, undefined, kind), [L, R] = run(p, true, kind), what = `${name}, ${kind}`;
  // as the firmware wrote it: one output, on both sides
  ok(rms(fL) > 1 && same(fL, fR), `${what}: not stereo unless asked, and not silent`);
  // stereo: the left is that same output; the right is another signal, as loud, and nothing like it
  ok(same(L, fL), `${what}: the left side changed`);
  ok(!same(R, L), `${what}: the right side is the left`);
  const d = dB(rms(R)) - dB(rms(L)), c = corr(L, R);
  ok(Math.abs(d) < 0.5, `${what}: right ${d.toFixed(2)} dB against the left`);
  ok(Math.abs(c) < 0.1, `${what}: left and right alike, correlation ${c.toFixed(3)}`);
  ok(R.every((x) => Number.isFinite(x) && Math.abs(x) <= 32768), `${what}: the right side out of range`);
}
// the tail dies away on both sides alike: the last half second of a burst is as quiet on the right as on the left
{ const [L, R] = run(SETTINGS['long, early full'], true, 'burst', 4), a = Math.floor(REAL_FS * 1), b = Math.floor(REAL_FS * 1.5);
  const d = dB(rms(R.subarray(a, b))) - dB(rms(L.subarray(a, b)));
  ok(rms(L.subarray(a, b)) > 5 && Math.abs(d) < 1, `the tail from 1 to 1.5 s: right ${d.toFixed(2)} dB against the left`); }
// the right side's tilt EQ follows the tone: dark is duller than bright on the right as on the left
{ const hf = (a) => { let s = 0; for (let i = 1; i < a.length; i++) s += (a[i] - a[i - 1]) ** 2; return Math.sqrt(s / a.length) / (rms(a) + 1e-9); };
  const dark = run([0.4, 0.7, 0.1, 0.5], true, 'burst'), bright = run([0.4, 0.7, 0.9, 0.5], true, 'burst'), v = [hf(dark[0]), hf(dark[1]), hf(bright[0]), hf(bright[1])];
  ok(v[3] > v[1] * 1.2 && v[2] > v[0] * 1.2 && Math.abs(v[1] / v[0] - 1) < 0.15 && Math.abs(v[3] / v[2] - 1) < 0.15, `tone, left and right: dark ${v[0].toFixed(3)} ${v[1].toFixed(3)}, bright ${v[2].toFixed(3)} ${v[3].toFixed(3)}`); }

// the instrument: a hit with no reverb send differs between the sides only by its pan; with a send the sides differ
// far more, and that difference is the reverb's
{ const play = (send) => { const inst = new LxrInstrument(REAL_FS), n = Math.floor(REAL_FS * 1.2), L = new Float32Array(n), R = new Float32Array(n), l = new Float32Array(441), r = new Float32Array(441);
    inst.setParam(sendPar(0, 1), send); inst.play(0, 60, 110, null, false);
    for (let at = 0; at + 441 <= n; at += 441) { inst.render(l, r); L.set(l, at); R.set(r, at); }
    const S = L.map((x, i) => x - R[i]); return { side: rms(S), mid: rms(L.map((x, i) => x + R[i])), lr: dB(rms(R)) - dB(rms(L)) }; };
  const dry = play(0), wet = play(127);
  ok(new LxrInstrument(REAL_FS).verb.stereo === true, 'the instrument\'s reverb is not set to stereo');
  console.log('  the instrument, no send and full send (side, mid, right - left dB):', [dry, wet].map((x) => [x.side.toFixed(5), x.mid.toFixed(5), x.lr.toFixed(2)].join(' ')).join(' | '));
  ok(dry.mid > 1e-4 && dry.side < dry.mid * 0.02, `no send: left and right differ by ${dry.side} of ${dry.mid}`);
  ok(wet.side > dry.side * 10 && wet.side > wet.mid * 0.05 && Math.abs(wet.lr - dry.lr) < 1, `with the send: the sides differ by ${wet.side.toFixed(5)} of ${wet.mid.toFixed(5)}, right ${wet.lr.toFixed(2)} dB against the left`); }

console.log(fails ? `${fails} of ${checks} checks failed` : `ok: ${checks} checks`);
process.exit(fails ? 1 : 0);
