// The wavetable oscillator: TABLE 0 (CLASSIC) is the firmware's waves (test/golden.test.mjs keeps every bucket sound
// sample for sample); TABLE 1 to 11 play METAMORF's tables at the right pitch, the WAVE knob moves along them smoothly,
// modulated too, and the AudioWorklet's way (a table posted to it) plays the same as a table made in place.
//   node test/wavetable.test.mjs
import assert from 'node:assert/strict';
import { LxrInstrument } from '../sound/instrument.js';
import { SOUNDS, INIT_VALUES, ALL_PARAMS, tablePar, ukeyPar, modOf, extraPar, VOICE_SCHEMAS } from '../sound/schema.js';
import { TABLE_NAMES, tableFor } from '../sound/tables.js';
import { BUCKET } from '../sound/bucket-sounds.js';
import { toVoice, fromVoice, tidy } from '../sound/bucket.js';
import { measure } from '../sound/level.js';
import { WAVE_MAX } from '../engine/lxr.js';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
assert.equal(TABLE_NAMES.length, 12); assert.equal(TABLE_NAMES[0], 'classic'); n += 2;

// a bucket sound on voice v with its TABLE and WAVE set: the voice's output, blocks long
function play(snd, v, table, wave, { blocks = 120, build = true, setup } = {}) {
  const inst = new LxrInstrument(44140); inst.build = build;
  const vals = Float64Array.from(INIT_VALUES.subarray(0, ALL_PARAMS));
  for (const [p, x] of toVoice(snd, v)) vals[p] = x;
  vals[tablePar(v)] = table; if (wave !== undefined) vals[ukeyPar(v, 'wave')] = wave;
  inst.loadKit(vals); for (const [p, x] of toVoice(snd, v)) if (p !== ukeyPar(v, 'wave') && p !== tablePar(v)) inst.setParam(p, x);
  if (wave !== undefined) inst.setParam(ukeyPar(v, 'wave'), wave);
  if (setup) setup(inst);
  inst.e.trigger(SOUNDS.find((s) => s.engineVoice === v).trigger, 100, 60);
  const out = []; for (let b = 0; b < blocks; b++) out.push(...inst.e.renderBlock(v)[v]);
  return { out, inst };
}
const rms = (x) => Math.sqrt(x.reduce((a, q) => a + q * q, 0) / x.length);
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// a plain tone: BASIC at its first frame is a sine, at the pitch the classic sine plays
{
  const snd = { voice: 0, params: { coarse: 69, fine: 64, wave: 0, decay: 120, attack: 0, nmix: 0, again: 0, clickvol: 0, pamt: 0, cutoff: 127, ftype: 0, level: 127 } };
  const s = tidy({ name: 'TONE', type: 'drum 1', ...snd }) || snd;
  const classic = play(s, 0, 0, 0, { blocks: 200 }).out, wt = play(s, 0, 1, 0, { blocks: 200 }).out;
  const crossings = (x) => { let c = 0; for (let i = 2000; i < x.length; i++) if (x[i - 1] < 0 && x[i] >= 0) c++; return c; };
  ok(Math.abs(crossings(classic) - crossings(wt)) <= 1, `BASIC's sine plays at the classic sine's pitch (${crossings(classic)} / ${crossings(wt)} cycles)`);
  ok(rms(wt) > rms(classic) * 0.5 && rms(wt) < rms(classic) * 2, 'and about as loud');
}

// every table on every voice: a sound, no NaN, no overflow, different from CLASSIC
const drum = BUCKET.find((s) => s.type === 'drum 1' && s.params.nmix === 0 && s.params.again > 0) || BUCKET[0];
for (let v = 0; v < 6; v++) {
  const base = play(drum, v, 0, 60).out;
  for (let t = 1; t < TABLE_NAMES.length; t++) {
    const x = play(drum, v, t, 60).out;
    ok(x.every(Number.isFinite), `${TABLE_NAMES[t]} on voice ${v}: numbers`);
    ok(rms(x) > 30, `${TABLE_NAMES[t]} on voice ${v} sounds (rms ${rms(x).toFixed(0)})`);
    ok(!same(x, base), `${TABLE_NAMES[t]} on voice ${v} differs from CLASSIC`);
  }
}

// the WAVE knob moves along the table: its ends differ, a decimal lands between
{
  const at = (w) => play(drum, 0, 6, w).inst.e.voices[0].osc.wpos;
  assert.equal(at(0), 0); assert.equal(at(WAVE_MAX), 1); ok(Math.abs(at(62.5) - 0.5) < 1e-9, 'WAVE halfway is halfway along the table'); n += 2;
  ok(!same(play(drum, 0, 6, 0).out, play(drum, 0, 6, WAVE_MAX).out), 'the first and last frames sound different');
  // on a table the dial has no detents: 26 is just past 25, not the next wave
  ok(Math.abs(at(26) - 26 / WAVE_MAX) < 1e-9, 'no detents on a table');
}

// an LFO on WAVE sweeps smoothly along the table (not wave to wave as on CLASSIC)
{
  const { inst } = play(drum, 0, 6, 60, { blocks: 1, setup: (i) => { const m = modOf(0, 'wave'); i.setParam(m.src, 1); i.setParam(m.amt, 127 + 60); i.setParam(ukeyPar(0, 'lfofreq'), 90); } });
  const seen = new Set(); for (let b = 0; b < 1500; b++) { inst.e.renderBlock(0); seen.add(inst.e.voices[0].osc.wpos.toFixed(3)); }
  ok(seen.size > 50, `an LFO on WAVE moves smoothly along the table (${seen.size} places)`);
}

// the AudioWorklet's way: it never builds a table; it plays CLASSIC until the page posts the table, then the table
{
  const id = 'builtin:steps', t = 11; assert.equal(TABLE_NAMES[t], 'steps');
  LxrInstrument.drop(id); ok(!LxrInstrument.holds(id), 'STEPS not made yet');
  const classic = play(drum, 0, 0, 60).out;
  const before = play(drum, 0, t, 60, { build: false });
  ok(same(before.out, classic), 'a table not posted yet plays CLASSIC');
  const after = play(drum, 0, t, 60, { build: false, setup: (i) => i.hold(tableFor(t)) }).out, // (what the page posts: { type: 'table', t })
    made = play(drum, 0, t, 60).out;
  ok(same(after, made), 'a posted table plays the same as one made in place');
}

// the bucket keeps a sound's table: saved, read back from a file, put on another voice
{
  const vals = new Map(toVoice(drum, 0)); vals.set(tablePar(0), 8);
  const s = fromVoice(vals, 0, { name: 'T', type: 'drum 1' });
  assert.equal(s.params.table, 8); assert.equal(tidy(s).params.table, 8);
  assert.equal(new Map(toVoice(s, 4)).get(tablePar(4)), 8); n += 3;
  assert.equal(new Map(toVoice(drum, 2)).get(tablePar(2)) ?? 0, 0); n++; // (an older sound: CLASSIC)
}

// AUTO LEVEL measures a key with its table
{
  const kit = Float64Array.from(INIT_VALUES.subarray(0, ALL_PARAMS)), vals = new Map(toVoice(drum, 0));
  const a = measure(0, kit, vals), b = measure(0, kit, new Map([...vals, [tablePar(0), 6]]));
  ok(Number.isFinite(b.db) && b.db !== a.db, `AUTO LEVEL hears the table (${a.db.toFixed(1)} / ${b.db.toFixed(1)} dB)`);
}
console.log(`wavetable: ${n} checks pass`);
