// The wavetable oscillator, the only oscillator since 2026-11-19 (CLASSIC, the firmware's waves, is gone; a TABLE of 0,
// from an older save, plays BASIC): TABLE 1 to 11 play METAMORF's tables at the right pitch, the WAVE knob moves along them smoothly,
// modulated too, and the AudioWorklet's way (a table posted to it) plays the same as a table made in place.
//   node test/wavetable.test.mjs
import assert from 'node:assert/strict';
import { LxrInstrument } from '../sound/instrument.js';
import { SOUNDS, INIT_VALUES, ALL_PARAMS, tablePar, ukeyPar, modOf, extraPar, VOICE_SCHEMAS, upgradeTables, TABLE_RULE, PAR } from '../sound/schema.js';
import { RECIPES } from '../sound/makers.js';
import { TABLE_NAMES, tableFor, classicOnBasic, BASIC, waveShape, frameStep, WAVE_TOP, NOISE, NOISE_POS, classicPlace, soundToTable } from '../sound/tables.js';
import { BUCKET } from '../sound/bucket-sounds.js';
import { toVoice, fromVoice, tidy } from '../sound/bucket.js';
import { measure } from '../sound/level.js';
import { WAVE_MAX } from '../engine/lxr.js';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
assert.equal(TABLE_NAMES.length, 14); assert.equal(TABLE_NAMES[0], 'basic'); n += 2;

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

// a plain tone: BASIC at its first frame is a sine, at the key's pitch (A 440 at coarse 69)
{
  const snd = { voice: 0, params: { coarse: 69, fine: 64, wave: 0, decay: 120, attack: 0, nmix: 0, again: 0, clickvol: 0, pamt: 0, cutoff: 127, ftype: 0, level: 127 } };
  const s = tidy({ name: 'TONE', type: 'drum 1', ...snd }) || snd;
  const wt = play(s, 0, 1, 0, { blocks: 200 }).out, old = play(s, 0, 0, 0, { blocks: 200 }).out;
  const crossings = (x) => { let c = 0; for (let i = 2000; i < x.length; i++) if (x[i - 1] < 0 && x[i] >= 0) c++; return c; };
  const want = 440 * (wt.length - 2000) / 44140;
  ok(Math.abs(crossings(wt) - want) <= 0.03 * want + 2, `BASIC's sine plays at the key's pitch (${crossings(wt)} cycles, ${want.toFixed(0)} wanted)`);
  ok(rms(wt) > 1000, 'and sounds');
  ok(same(old, wt), 'a TABLE of 0 (an older save) plays BASIC');
}

// every table on every voice: a sound, no NaN, no overflow, different from BASIC
const drum = BUCKET.find((s) => s.type === 'drum 1' && s.params.nmix === 0 && s.params.again > 0) || BUCKET[0];
for (let v = 0; v < 6; v++) {
  const base = play(drum, v, BASIC, 60).out;
  for (let t = 2; t < TABLE_NAMES.length; t++) {
    const x = play(drum, v, t, 60).out;
    ok(x.every(Number.isFinite), `${TABLE_NAMES[t]} on voice ${v}: numbers`);
    ok(rms(x) > 30, `${TABLE_NAMES[t]} on voice ${v} sounds (rms ${rms(x).toFixed(0)})`);
    ok(!same(x, base), `${TABLE_NAMES[t]} on voice ${v} differs from BASIC`);
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

// an LFO on WAVE sweeps smoothly along the table
{
  const { inst } = play(drum, 0, 6, 60, { blocks: 1, setup: (i) => { const m = modOf(0, 'wave'); i.setParam(m.src, 1); i.setParam(m.amt, 127 + 60); i.setParam(ukeyPar(0, 'lfofreq'), 90); } });
  const seen = new Set(); for (let b = 0; b < 1500; b++) { inst.e.renderBlock(0); seen.add(inst.e.voices[0].osc.wpos.toFixed(3)); }
  ok(seen.size > 50, `an LFO on WAVE moves smoothly along the table (${seen.size} places)`);
}

// the AudioWorklet's way: it never builds a table; the oscillator is silent until the page posts the table, then plays it
{
  const id = 'builtin:steps', t = 11; assert.equal(TABLE_NAMES[t], 'steps');
  LxrInstrument.drop(id); ok(!LxrInstrument.holds(id), 'STEPS not made yet');
  const before = play(drum, 0, t, 60, { build: false });
  ok(before.out.every(Number.isFinite), 'a table not posted yet: no NaN');
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
  n++;
  // an older sound with no tables: moved onto BASIC (or NOISE) as it comes in, MOD A and B too
  const up = soundToTable({ ...drum, params: { ...old, atable: 0, btable: 0, wave: 50, awave: 75, bwave: 125 } }).params;
  ok(up.table === BASIC && up.atable === BASIC && up.btable === NOISE && up.wave === classicOnBasic(50, 0) && up.awave === classicOnBasic(75, 0) && up.bwave === NOISE_POS,
    'an older sound: its three waves move onto tables');
}

// AUTO LEVEL measures a key with its table
{
  const kit = Float64Array.from(INIT_VALUES.subarray(0, ALL_PARAMS)), vals = new Map(toVoice(drum, 0));
  const a = measure(0, kit, vals), b = measure(0, kit, new Map([...vals, [tablePar(0), 6]]));
  ok(Number.isFinite(b.db) && b.db !== a.db, `AUTO LEVEL hears the table (${a.db.toFixed(1)} / ${b.db.toFixed(1)} dB)`);
}

// an older save's classic waves: each one's place on BASIC (frames sine 0, tri 10, saw 20, square 30, pulse to
// 40), noise has none
{
  const at = (w, pwm = 0) => classicOnBasic(w, pwm), fr = (k) => Math.round(k / 40 * WAVE_TOP * 100) / 100;
  assert.equal(TABLE_NAMES[BASIC], 'basic'); n++;
  assert.equal(at(0), fr(0)); assert.equal(at(25), fr(10)); assert.equal(at(50), fr(20)); assert.equal(at(75), fr(30)); n += 4;
  assert.equal(at(12.5), fr(5)); n++; // (a blend of sine and triangle: halfway between their frames)
  ok(at(100, 127) === fr(30) && at(100, 0) === fr(40) && at(100, 60) > fr(30) && at(100, 60) < fr(40), 'the PWM wave lands on the narrowing pulses: square at full PWM, narrower with less');
  ok(at(WAVE_TOP) === null && at(WAVE_TOP - 10) === null, 'noise has no place on BASIC');
}

// a saved patch from before (no tableRule): every key's classic waves move onto tables once, on load
{
  ok(TABLE_RULE >= 1, 'patches carry the table rule');
  const vals = Float64Array.from(INIT_VALUES.subarray(0, ALL_PARAMS));
  for (const w of [0, 1, 2]) vals[tablePar(0, w)] = 0;
  vals[ukeyPar(0, 'wave')] = 75; vals[ukeyPar(0, 'awave')] = 125; vals[ukeyPar(0, 'bwave')] = 25;
  vals[tablePar(1)] = 7; vals[ukeyPar(1, 'wave')] = 33; // (already on a table: left alone)
  const keys = [{ 3: { [ukeyPar(0, 'wave')]: 100, [ukeyPar(0, 'pwm')]: 127 } }];
  upgradeTables(vals, keys);
  ok(vals[tablePar(0)] === BASIC && vals[ukeyPar(0, 'wave')] === classicOnBasic(75, 0), 'the base square moves onto BASIC');
  ok(vals[tablePar(0, 1)] === NOISE && vals[ukeyPar(0, 'awave')] === NOISE_POS && vals[tablePar(0, 2)] === BASIC, 'MOD A\'s noise onto NOISE, MOD B onto BASIC');
  ok(vals[tablePar(1)] === 7 && vals[ukeyPar(1, 'wave')] === 33, 'a voice already on a table stays put');
  ok(keys[0][3][tablePar(0)] === BASIC && keys[0][3][ukeyPar(0, 'wave')] === classicOnBasic(100, 127), 'a key\'s own PWM wave moves onto BASIC too');
  const u = upgradeTables(Float64Array.from(vals)); ok(u.every((x, i) => x === vals[i]), 'upgrading twice changes nothing');
}

// the recipes (NEW SOUND) and the starting patch are on tables
{
  ok(Object.values(RECIPES).every((m) => !('table' in m.set) || m.set.table >= 1), 'the recipes pick a table');
  for (let v = 0; v < 6; v++) for (const w of [0, 1, 2]) ok(INIT_VALUES[tablePar(v, w)] >= 1, `the starting patch: voice ${v} oscillator ${w} on a table`);
  ok(VOICE_SCHEMAS.every((sc) => sc.filter((e) => e.table).every((e) => e.min === 1)), 'the TABLE knobs start at 1 (no CLASSIC)');
  ok(VOICE_SCHEMAS.every((sc) => sc.filter((e) => e.ukey === 'pwm').every((e) => e.hidden)), 'no PWM knob');
}

// the picture in the OSC heading: one cycle, -1..1, BASIC's first frame a sine
{
  const t = waveShape(BASIC, 0);
  ok(t.length === 96 && t.every((x) => Math.abs(x) <= 1.01), 'the picture is one cycle within -1..1');
  ok(t.every((x, i) => Math.abs(x - Math.sin(2 * Math.PI * i / 96)) < 0.05 || Math.abs(x + Math.cos(2 * Math.PI * i / 96)) < 0.05) || Math.max(...t) > 0.9, 'BASIC\'s first frame draws a sine');
  ok(Math.abs(frameStep(BASIC) - WAVE_TOP / 40) < 1e-9, 'neighbour frames on BASIC are one frame apart');
}

// NOISE and DUST: LXR-AFX's own tables, read STEPS times slower so their random steps come at the key's pitch
{
  ok(TABLE_NAMES[NOISE] === 'noise' && TABLE_NAMES[NOISE + 1] === 'dust', 'NOISE and DUST follow the METAMORF tables');
  const t = tableFor(NOISE), d = tableFor(NOISE + 1);
  ok(t.div === 256 && d.div === 256 && t.frames === 41 && d.frames === 33, 'NOISE (41 frames) and DUST (33) read 256 times slower');
  assert.deepEqual(classicPlace(WAVE_TOP, 0), [NOISE, NOISE_POS]); assert.deepEqual(classicPlace(0, 0), [BASIC, 0]); n += 2;
  assert.equal(soundToTable({ params: { wave: 125 } }).params.table, NOISE); n++;
  ok(BUCKET.every((s) => s.params.table > 0), 'every bucket sound is on a table');
  const snd = BUCKET.find((s) => s.params.table === NOISE && s.params.nmix === 0 && s.params.again === 0) || BUCKET.find((s) => s.params.table === NOISE);
  for (const [tab, pos] of [[NOISE, 0], [NOISE, 90], [NOISE, 125], [NOISE + 1, 0], [NOISE + 1, 125]]) { const o = play(snd, snd.voice, tab, pos, { blocks: 40 }).out; ok(o.every(Number.isFinite) && rms(o) > 0, `${TABLE_NAMES[tab]} at ${pos} sounds`); }
}

// MOD A and MOD B: a table each (tablePar(v, 1 / 2)), their WAVE knobs moving along it
{
  const fm = BUCKET.find((s) => s.params.again > 40 && s.params.bgain > 40), v = fm.voice;
  const run = (setup) => play(fm, v, fm.params.table, undefined, { blocks: 60, setup }).out;
  const plain = run(), a = run((inst) => { inst.setParam(tablePar(v, 1), 7); inst.setParam(ukeyPar(v, 'awave'), 80); }), b = run((inst) => { inst.setParam(tablePar(v, 2), NOISE); });
  ok(tablePar(0, 1) === tablePar(5) + 1 && tablePar(5, 2) === ALL_PARAMS - 1, 'MOD A and B tables come after the tones\' (older saves line up)');
  ok(!same(plain, a) && a.every(Number.isFinite), `MOD A on a table changes the FM (${fm.name})`);
  ok(!same(plain, b) && b.every(Number.isFinite), 'MOD B on a table changes it too');
  ok(BUCKET.every((s) => s.params.atable >= 1 && s.params.btable >= 1), 'every bucket sound has MOD A and B on tables');
  const sch = VOICE_SCHEMAS[v].filter((e) => e.table).map((e) => e.ukey);
  assert.deepEqual(sch, ['table', 'atable', 'btable']); n++;
  const vals = new Map(toVoice(fm, v)); vals.set(tablePar(v, 1), 9); vals.set(tablePar(v, 2), 3);
  const s2 = fromVoice(vals, v, { name: 'T', type: fm.type });
  ok(s2.params.atable === 9 && s2.params.btable === 3 && new Map(toVoice(s2, 0)).get(tablePar(0, 1)) === 9, 'the bucket keeps MOD A and B tables, on any voice');
}
console.log(`wavetable: ${n} checks pass`);
