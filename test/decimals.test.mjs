// Knobs take decimals: a value between two whole numbers sets the sound between them, and is kept as it is (not cut
// to a whole number) by the engine, the bucket and the presets.   node test/decimals.test.mjs
import assert from 'node:assert/strict';
import { LxrEngine, PAR, EX } from '../engine/lxr.js';
import { VOICE_SCHEMAS, extraPar, NUM_PARAMS, NUM_EXTRAS, modOf, ukeyPar, INIT_VALUES, ALL_PARAMS } from '../sound/schema.js';
import { LxrInstrument } from '../sound/instrument.js';
import { tidy, toVoice, fromVoice } from '../sound/bucket.js';
import { BUCKET } from '../sound/bucket-sounds.js';
import { blend } from '../sound/makers.js';

let n = 0;
const between = (x, a, b, what) => { assert.ok((x > a && x < b) || (x < a && x > b), `${what}: ${x} not between ${a} and ${b}`); n++; };
// a value of the engine's state after setting a parameter (or an extra) to v
function at(par, v, read, extra = -1) {
  const e = new LxrEngine(); e.loadInitKit();
  if (extra >= 0) e.setExtra(0, extra, v); else e.setParam(par, v);
  e.trigger(0, 100, 60);
  return read(e.voices[0]);
}
function check(what, par, lo, read, extra = -1) {
  const a = at(par, lo, read, extra), m = at(par, lo + 0.5, read, extra), b = at(par, lo + 1, read, extra);
  between(m, a, b, what);
}
check('coarse', PAR.COARSE1, 60, (v) => v.osc.freq);
check('coarse at the bottom', PAR.COARSE1, 0, (v) => v.osc.freq);
check('fine', PAR.FINE1, 64, (v) => v.osc.freq);
check('decay', PAR.VELOD1, 100, (v) => v.oscVolEg.decay);
check('decay near the top', PAR.VELOD1, 125, (v) => v.oscVolEg.decay);
check('attack', PAR.VELOA1, 3, (v) => v.oscVolEg.attack);
check('pitch decay', PAR.MOD_EG1, 40, (v) => v.oscPitchEg.decay);
check('pitch amount', PAR.MODAMNT1, 40, (v) => v.egPitchModAmount);
check('cutoff', PAR.FILTER_FREQ_1 ?? PAR.FILTER_FREQ_DRUM1, 1, (v) => v.filter.f);
check('pan', PAR.PAN1, 63, (v) => v.triggeredPanL);
check('amp slope', PAR.VOL_SLOPE1, 50, (v) => v.oscVolEg.slope);
check('mod A freq (an extra)', 0, 60, (v) => v.modOsc.freq, EX.A_FREQ);
check('pitch decay (an extra)', 0, 40, (v) => v.oscPitchEg.decay, EX.PITCH_DECAY);
// a decimal coarse tune is exactly a fraction of a semitone
{ const a = at(PAR.COARSE1, 60, (v) => v.osc.freq), m = at(PAR.COARSE1, 60.25, (v) => v.osc.freq);
  assert.ok(Math.abs(1200 * Math.log2(m / a) - 25) < 0.1, 'coarse 60.25 is 25 cents above 60'); n++; }
// whole menus and counts stay whole
{ const e = new LxrEngine(); e.loadInitKit(); e.setExtra(0, EX.REPEAT, 2.6); assert.equal(e.voices[0].oscVolEg.repeat, 3); e.setExtra(0, EX.KIND, 0.2); assert.equal(e.voices[0].kind, 'drum'); n += 2; }
// every knob of every voice keeps a decimal: the engine stores it as given
for (let v = 0; v < 6; v++) {
  const inst = new LxrInstrument(44140);
  for (const e of VOICE_SCHEMAS[v]) {
    if (e.par >= NUM_PARAMS || !e.ukey || e.hidden || e.display.type !== 'num' || e.max < 2) continue;
    inst.setParam(e.par, 1.25);
    assert.equal(inst.e.activeParameters[e.par], 1.25, `voice ${v} ${e.ukey}`); n++;
  }
  for (let k = 0; k < NUM_EXTRAS; k++) { inst.setParam(extraPar(v, k), 10.5); if (inst.e.voices[v].extra[k] === 10.5) n++; }
}
// the bucket keeps decimals, to two places, through a file and back
{ const s = structuredClone(BUCKET[0]); s.params.decay = 61.2345; s.params.coarse = 40.5;
  const t = tidy(s); assert.equal(t.params.decay, 61.23); assert.equal(t.params.coarse, 40.5);
  const back = fromVoice(toVoice(t, t.voice), t.voice, { name: 'X', type: t.type });
  assert.equal(back.params.decay, 61.23); assert.equal(back.params.coarse, 40.5); n += 4; }
// modulation moves a control smoothly: an LFO on the coarse tune sweeps through the pitches between semitones
{ const inst = new LxrInstrument(44140); inst.loadKit(INIT_VALUES.slice(0, ALL_PARAMS));
  const m = modOf(0, 'coarse'); inst.setParam(m.depths[1], 127 + 40);
  inst.setParam(ukeyPar(0, 'lfofreq'), 90); inst.e.trigger(0, 100, 60);
  const cents = new Set();
  for (let b = 0; b < 2000; b++) { inst.e.renderBlock(0); const c = 1200 * Math.log2(inst.e.voices[0].osc.freq / 440); cents.add(Math.round(((c % 100) + 100) % 100)); }
  assert.ok(cents.size > 20, `an LFO on coarse lands between semitones (${cents.size} different cents)`); n++; }
// a blend keeps the value between: decay 10 and 11 halfway is 10.5, not 11
{ const sc = VOICE_SCHEMAS[0], d = ukeyPar(0, 'decay'), c = ukeyPar(0, 'cutoff');
  const out = blend({ schema: sc, a: new Map([[d, 10], [c, 40]]), b: new Map([[d, 11], [c, 43]]), t: 0.5, base: INIT_VALUES });
  assert.equal(out.get(d), 10.5); assert.equal(out.get(c), 41.5); n += 2; }
console.log(`decimals: ${n} checks pass`);
