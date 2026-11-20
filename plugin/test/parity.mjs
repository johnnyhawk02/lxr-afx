// The C++ engine (plugin/src/engine) against the web app's own JS (plugin/js/dsp-entry.js on sound/ + engine/), sample
// for sample, on scripts of messages and MIDI: every bucket sound on its own voice, then the effects, the master,
// MORPH TIME, the wavetables, RETURN and other sample rates. A difference means the JS changed and the C++ needs
// porting (or the port is wrong). Run after `node plugin/tools/bundle.mjs` and building the parity tool:
//   node plugin/test/parity.mjs path/to/lxr_parity [--quick]
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SOUNDS, INIT_VALUES, ALL_PARAMS, SEND_BASE, TABLE_BASE, EXTRA_BASE, NUM_EXTRAS } from '../../sound/schema.js';
import { BUCKET } from '../../sound/bucket-sounds.js';
import { toVoice } from '../../sound/bucket.js';
import { FX_DEFAULTS } from '../../sound/instrument.js';

const bin = process.argv[2];
const quick = process.argv.includes('--quick');
if (!bin) { console.error('usage: node plugin/test/parity.mjs <lxr_parity binary> [--quick]'); process.exit(2); }
const src = fs.readFileSync(fileURLToPath(new URL('../build/dsp.js', import.meta.url)), 'utf8');
const plain = (k, v) => (ArrayBuffer.isView(v) ? Array.from(v) : v);
const values = Array.from(INIT_VALUES.subarray(0, ALL_PARAMS));
const soundOf = (voice) => SOUNDS.findIndex((s) => s.engineVoice === voice);

function runJs(ops) {
  const g = {}; new Function('globalThis', src)(g); const lxr = g.lxr;
  let L = null, R = null; const out = [];
  for (const o of ops) {
    if (o.op === 'init') { L = new Float32Array(1 << 16); R = new Float32Array(1 << 16); lxr.init(o.sr, L, R); }
    else if (o.op === 'msg') lxr.msg(JSON.stringify(o.m, plain));
    else if (o.op === 'midi') lxr.midi(...o.d);
    else if (o.op === 'render') { lxr.render(o.n); const f = new Float32Array(2 * o.n); for (let i = 0; i < o.n; i++) { f[2 * i] = L[i]; f[2 * i + 1] = R[i]; } out.push(f); }
  }
  if (g.lxrError) console.log('JS error:', g.lxrError);
  const all = new Float32Array(out.reduce((s, f) => s + f.length, 0)); let p = 0; for (const f of out) { all.set(f, p); p += f.length; }
  return all;
}
function runCpp(ops) {
  const r = spawnSync(bin, [], { input: ops.map((o) => JSON.stringify(o, plain)).join('\n') + '\n', maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error('lxr_parity failed: ' + r.stderr);
  if (r.stderr.length) console.log(String(r.stderr).trim());
  return new Float32Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.length / 4);
}
const render = (ops, samples, n = 128) => { for (let k = 0; k < samples; k += n) ops.push({ op: 'render', n: Math.min(n, samples - k) }); };

// ---- the scenarios ----
const scenarios = [];
// 1. every bucket sound alone, on its own voice (engines 6, so every voice is in use)
const sounds = quick ? BUCKET.filter((_, i) => i % 25 === 0) : BUCKET;
for (let b = 0; b < sounds.length; b += 40) {
  const ops = [];
  for (const snd of sounds.slice(b, b + 40)) {
    const v = snd.voice, s = soundOf(v), p = toVoice(snd, v);
    ops.push({ op: 'init', sr: 48000 }, { op: 'msg', m: { type: 'engines', n: 6 } }, { op: 'msg', m: { type: 'kit', values } });
    ops.push({ op: 'msg', m: { type: 'keys', full: true, keys: [[60, s, 60, p], [64, s, 67, p], [55, s, 48, p]] } });
    ops.push({ op: 'midi', d: [0x90, 60, 100] }); render(ops, 9000, 128);
    ops.push({ op: 'midi', d: [0x90, 64, 64] }); render(ops, 7000, 100);
    ops.push({ op: 'midi', d: [0x80, 64, 0] }); ops.push({ op: 'midi', d: [0x80, 60, 0] });
    ops.push({ op: 'midi', d: [0x90, 55, 127] }); render(ops, 6000, 256);
  }
  scenarios.push({ name: `bucket sounds ${b + 1}-${Math.min(b + 40, sounds.length)}`, ops });
}
// 2. the effects and the master, three engines at once, with sends, MORPH TIME, RETURN, a wavetable
function mix(sr, fx, extra = (p) => p) {
  const ops = [{ op: 'init', sr }, { op: 'msg', m: { type: 'engines', n: 3 } }, { op: 'msg', m: { type: 'kit', values } }, { op: 'msg', m: { type: 'fx', fx } }];
  const keys = [];
  for (let s = 0; s < 3; s++) {
    const v = SOUNDS[s].engineVoice;
    for (let j = 0; j < 3; j++) {
      const snd = BUCKET.filter((x) => x.voice === v || (v === 0 && x.voice < 3))[j * 7 + s];
      const p = extra(toVoice(snd || BUCKET[s], v), v, j);
      p.push([SEND_BASE + v * 3, 40 + 30 * j], [SEND_BASE + v * 3 + 1, 60]);
      keys.push([SOUNDS[s].zone.lo + j, s, 60 + j * 3, p]);
    }
  }
  ops.push({ op: 'msg', m: { type: 'keys', full: true, keys } });
  let t = 0;
  for (let k = 0; k < 24; k++) {
    const [note] = keys[(k * 5) % keys.length];
    ops.push({ op: 'midi', d: [0x90, note, 40 + (k * 13) % 88] });
    render(ops, 2205 + (k % 3) * 400, 64 + (k % 4) * 32); t++;
    if (k % 4 === 3) ops.push({ op: 'midi', d: [0x80, note, 0] });
  }
  // hold two keys of a zone and let go of the newer: back to the first on the RETURN grid
  ops.push({ op: 'midi', d: [0x90, keys[0][0], 90] }, { op: 'midi', d: [0x90, keys[1][0], 90] }); render(ops, 3000);
  ops.push({ op: 'midi', d: [0x80, keys[1][0], 0] }); render(ops, 6000);
  ops.push({ op: 'msg', m: { type: 'param', par: values.length > 10 ? 10 : 1, value: 77 } }); render(ops, 4000);
  ops.push({ op: 'midi', d: [0xb0, 123, 0] }); render(ops, 30000);
  return ops;
}
const fx = (o) => { const f = structuredClone(FX_DEFAULTS); for (const k in o) Object.assign(f[k], o[k]); return f; };
scenarios.push({ name: 'echo + reverb, defaults', ops: mix(48000, fx({})) });
scenarios.push({ name: 'distortion on, LED clip, xover, reverb post', ops: mix(48000, fx({ dirt: { on: 1, clip: 1, xover: 1, gain: 100, tone: 30, clean: 60 }, reverb: { post: 1 } })) });
scenarios.push({ name: 'echo synced, ping-pong off, duck', ops: mix(44100, fx({ echo: { sync: 1, div: 3, pingpong: 0, duck: 90 }, tempo: { bpm: 133 } })) });
scenarios.push({ name: 'MORPH TIME 300 ms, RETURN now, compressor hard', ops: mix(48000, fx({ tempo: { morph: 300, ret: 0 }, master: { thresh: 30, ratio: 120, attack: 1, knee: 0, makeup: 9 } })) });
scenarios.push({ name: 'wavetables on every voice, 96 kHz', ops: mix(96000, fx({}), (p, v, j) => { p.push([TABLE_BASE + v, 1 + ((v + j * 4) % 11)]); return p; }) });
{ // the MACRO knobs: set in the effects, then turned (and their targets changed) while keys play
  const ops = mix(48000, fx({ macros: { v: [127, 80, 100, 64, 127, 50, 90, 127] } })), at = Math.floor(ops.length / 3);
  ops.splice(at, 0, { op: 'msg', m: { type: 'macro', i: 2, v: 10 } }, { op: 'msg', m: { type: 'macro', i: 0, v: 0 } });
  ops.splice(2 * at, 0, { op: 'msg', m: { type: 'fx', fx: fx({ macros: { t: [[['pan', -80], ['wave', 50]], [['ftype', 70]], [['lfofreq', 40]], [], [['level', -60]], [], [], [['cutoff', -100]]] } }) } },
    { op: 'msg', m: { type: 'macro', i: 0, v: 127 } });
  scenarios.push({ name: 'MACRO knobs', ops });
}
scenarios.push({ name: 'extras moved, 22.05 kHz', ops: mix(22050, fx({ tempo: { morph: 120 } }), (p, v, j) => { for (let k = 1; k < NUM_EXTRAS; k++) p.push([EXTRA_BASE + v * NUM_EXTRAS + k, (k * 37 + j * 11) % 128]); return p; }) });

let bad = 0;
for (const sc of scenarios) {
  const a = runJs(sc.ops), b = runCpp(sc.ops);
  if (a.length !== b.length) { console.log(`${sc.name}: lengths differ (${a.length} JS, ${b.length} C++)`); bad++; continue; }
  let maxd = 0, diff = 0, at = -1, peak = 0;
  for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); peak = Math.max(peak, Math.abs(a[i])); if (d > 0) { diff++; if (d > maxd) { maxd = d; at = i; } } }
  const ok = diff === 0; // (bit for bit)
  if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'DIFF'} ${sc.name}: ${a.length / 2} frames, peak ${peak.toFixed(3)}, ${diff} samples differ, max ${maxd.toExponential(2)}${at >= 0 ? ` at frame ${at >> 1}` : ''}`);
}
console.log(bad ? `parity: ${bad} of ${scenarios.length} scenarios differ` : `parity: all ${scenarios.length} scenarios match`);
process.exit(bad ? 1 : 0);
