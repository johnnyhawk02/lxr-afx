// The wavetable oscillator: TABLE 0 (CLASSIC) is the firmware's waves (test/golden.test.mjs keeps every bucket sound
// sample for sample); TABLE 1 to 11 play METAMORF's tables at the right pitch, the WAVE knob moves along them smoothly,
// modulated too, and the AudioWorklet's way (a table posted to it) plays the same as a table made in place.
//   node test/wavetable.test.mjs
import assert from 'node:assert/strict';
import { LxrInstrument } from '../sound/instrument.js';
import { SOUNDS, INIT_VALUES, ALL_PARAMS, tablePar, ukeyPar, modOf, extraPar, VOICE_SCHEMAS } from '../sound/schema.js';
import { TABLE_NAMES, tableFor, classicOnBasic, BASIC, waveShape, frameStep, WAVE_TOP, NOISE, NOISE_POS, classicPlace, soundToTable } from '../sound/tables.js';
import { BUCKET } from '../sound/bucket-sounds.js';
import { toVoice, fromVoice, tidy } from '../sound/bucket.js';
import { measure } from '../sound/level.js';
import { WAVE_MAX } from '../engine/lxr.js';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
assert.equal(TABLE_NAMES.length, 14); assert.equal(TABLE_NAMES[0], 'classic'); n += 2;

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
  const { table, ...old } = drum.params; assert.equal(table, 1); // (the bucket is on BASIC)
  assert.equal(new Map(toVoice({ ...drum, params: old }, 2)).get(tablePar(2)) ?? 0, 0); n += 2; // (an older sound: CLASSIC)
}

// AUTO LEVEL measures a key with its table
{
  const kit = Float64Array.from(INIT_VALUES.subarray(0, ALL_PARAMS)), vals = new Map(toVoice(drum, 0));
  const a = measure(0, kit, vals), b = measure(0, kit, new Map([...vals, [tablePar(0), 6]]));
  ok(Number.isFinite(b.db) && b.db !== a.db, `AUTO LEVEL hears the table (${a.db.toFixed(1)} / ${b.db.toFixed(1)} dB)`);
}

// TOOLS > ALL KEYS TO WAVETABLE: each classic wave's place on BASIC (frames sine 0, tri 10, saw 20, square 30, pulse to
// 40), noise has none
{
  const at = (w, pwm = 0) => classicOnBasic(w, pwm), fr = (k) => Math.round(k / 40 * WAVE_TOP * 100) / 100;
  assert.equal(TABLE_NAMES[BASIC], 'basic'); n++;
  assert.equal(at(0), fr(0)); assert.equal(at(25), fr(10)); assert.equal(at(50), fr(20)); assert.equal(at(75), fr(30)); n += 4;
  assert.equal(at(12.5), fr(5)); n++; // (a blend of sine and triangle: halfway between their frames)
  ok(at(100, 127) === fr(30) && at(100, 0) === fr(40) && at(100, 60) > fr(30) && at(100, 60) < fr(40), 'the PWM wave lands on the narrowing pulses: square at full PWM, narrower with less');
  ok(at(WAVE_TOP) === null && at(WAVE_TOP - 10) === null, 'noise has no place on BASIC');
  // moved over, a plain sine plays as it did (the tables are read a quarter cycle behind, in the firmware's phase)
  const snd = { voice: 0, params: { coarse: 69, fine: 64, wave: 0, decay: 120, attack: 0, nmix: 0, again: 0, clickvol: 0, pamt: 0, cutoff: 127, ftype: 0, level: 127 } };
  const s = tidy({ name: 'TONE', type: 'drum 1', ...snd }) || snd;
  const a = play(s, 0, 0, 0).out, b = play(s, 0, BASIC, at(0)).out;
  let e = 0, d = 0; for (let i = 0; i < a.length; i++) { e += a[i] * a[i]; d += (a[i] - b[i]) ** 2; }
  ok(Math.sqrt(d / e) < 0.03, `a sine moved onto BASIC sounds the same (${(100 * Math.sqrt(d / e)).toFixed(1)}% apart)`);
}

// the picture in the OSC heading: one cycle, -1..1, the classic sine and BASIC's first frame the same shape
{
  const c = waveShape(0, 0), t = waveShape(BASIC, 0);
  ok(c.length === 96 && c.every((x) => Math.abs(x) <= 1.01), 'the picture is one cycle within -1..1');
  ok(c.every((x, i) => Math.abs(x - t[i]) < 0.02), 'CLASSIC sine and BASIC sine draw alike');
  ok(frameStep(0) === 0 && Math.abs(frameStep(BASIC) - WAVE_TOP / 40) < 1e-9, 'neighbour frames: none on CLASSIC, one frame apart on BASIC');
}

// NOISE and DUST: LXR-AFX's own tables, read STEPS times slower so their random steps come at the key's pitch
{
  ok(TABLE_NAMES[NOISE] === 'noise' && TABLE_NAMES[NOISE + 1] === 'dust', 'NOISE and DUST follow the METAMORF tables');
  const t = tableFor(NOISE), d = tableFor(NOISE + 1);
  ok(t.div === 256 && d.div === 256 && t.frames === 41 && d.frames === 33, 'NOISE (41 frames) and DUST (33) read 256 times slower');
  assert.deepEqual(classicPlace(WAVE_TOP, 0), [NOISE, NOISE_POS]); assert.deepEqual(classicPlace(0, 0), [BASIC, 0]); n += 2;
  assert.equal(soundToTable({ params: { wave: 125 } }).params.table, NOISE); n++;
  ok(BUCKET.every((s) => s.params.table > 0), 'every bucket sound is on a table');
  // the firmware's noise and NOISE's stepped noise: a new level at the key's pitch, so as busy (zero crossings) and loud
  const snd = BUCKET.find((s) => s.params.table === NOISE && s.params.nmix === 0 && s.params.again === 0) || BUCKET.find((s) => s.params.table === NOISE);
  const zc = (x) => { let c = 0; for (let i = 1; i < x.length; i++) if ((x[i - 1] < 0) !== (x[i] < 0)) c++; return c; };
  const a = play(snd, snd.voice, 0, WAVE_TOP, { blocks: 80 }).out, b = play(snd, snd.voice, NOISE, NOISE_POS, { blocks: 80 }).out;
  ok(Math.abs(zc(a) - zc(b)) <= 0.2 * zc(a) + 4 && rms(b) > 0.5 * rms(a) && rms(b) < 2 * rms(a), `NOISE plays like the classic noise (${zc(a)} / ${zc(b)} crossings, ${rms(a).toFixed(0)} / ${rms(b).toFixed(0)} rms)`);
  for (const [tab, pos] of [[NOISE, 0], [NOISE, 90], [NOISE, 125], [NOISE + 1, 0], [NOISE + 1, 125]]) { const o = play(snd, snd.voice, tab, pos, { blocks: 40 }).out; ok(o.every(Number.isFinite) && rms(o) > 0, `${TABLE_NAMES[tab]} at ${pos} sounds`); }
}
console.log(`wavetable: ${n} checks pass`);
