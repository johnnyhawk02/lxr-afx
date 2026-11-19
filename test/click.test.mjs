// node test/click.test.mjs: the click (engine/click.js, METAMORF's): its reference numbers, its five knobs on every
// voice, DIRECT skipping the filter and drive, and old sounds and patches moved onto it.
import assert from 'node:assert/strict';
import { Click, clickTone, clickLen, toneKnob, lenKnob } from '../engine/click.js';
import { LxrInstrument } from '../sound/instrument.js';
import { SOUNDS, INIT_VALUES, ALL_PARAMS, ukeyPar, clickPar, VOICE_SCHEMAS, oldClick, soundClicks, upgradeClicks, extraPar, CLICK_RULE } from '../sound/schema.js';
import { EX } from '../engine/lxr.js';
import { BUCKET } from '../sound/bucket-sounds.js';
import { toVoice, fromVoice } from '../sound/bucket.js';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };

// METAMORF's check: at 48 kHz, TONE 2 kHz, LENGTH 3 ms, LEVEL 1, the peaks of the five shapes and the length
for (const [sh, pk] of [[0, 1], [0.25, 0.63], [0.5, 0.93], [0.75, 0.94], [1, 1.2]]) {
  const c = new Click(48000); c.trigger(); let peak = 0, len = 0;
  while (c.on) { peak = Math.max(peak, Math.abs(c.next(1, sh, 2000, 3))); len++; }
  ok(Math.abs(peak - pk) < 0.02, `shape ${sh} peaks at ${pk} (${peak.toFixed(3)})`);
  ok(Math.abs(len - 144) <= 1, `and lasts 144 samples (${len})`);
}
ok(Math.abs(toneKnob(clickTone(70)) - 70) < 1e-9 && Math.abs(lenKnob(clickLen(30)) - 30) < 1e-9, 'TONE and LENGTH knobs map both ways');
ok(Math.abs(clickTone(0) - 20) < 1e-9 && Math.abs(clickTone(127) - 16000) < 1e-6 && Math.abs(clickLen(127) - 30) < 1e-9, 'TONE 20 Hz..16 kHz, LENGTH 0.2..30 ms');

// the schema: five knobs in the CLICK section on every voice, the old route switch hidden
for (const sc of VOICE_SCHEMAS) {
  ok(sc.filter((e) => e.section === 'click' && !e.hidden).map((e) => e.ukey).join() === 'clickvol,click,clickfreq,clicklen,clickdir', 'CLICK: level, shape, tone, length, direct');
  ok(sc.find((e) => e.ukey === 'rclick').hidden, 'CLICK IN is gone');
}

// on every voice: a click with a quiet body is heard, and DIRECT skips the filter
function play(v, set, blocks = 8) {
  const inst = new LxrInstrument(44140), vals = Float64Array.from(INIT_VALUES.subarray(0, ALL_PARAMS));
  const p = (u) => ukeyPar(v, u);
  Object.assign(vals, { [p('decay')]: 1, [p('again')]: 0, [p('bgain')]: 0, [p('nmix')]: 0, [p('cutoff')]: 127, [p('level')]: 127 });
  for (const [k, x] of Object.entries(set)) vals[k] = x;
  inst.loadKit(vals);
  inst.e.trigger(SOUNDS.find((s) => s.engineVoice === v).trigger, 127, 60);
  const out = []; for (let b = 0; b < blocks; b++) out.push(...inst.e.renderBlock(v)[v]);
  return out;
}
const energy = (x) => x.reduce((a, q) => a + q * q, 0);
for (let v = 0; v < 6; v++) {
  const p = (u) => ukeyPar(v, u), quiet = play(v, { [p('clickvol')]: 0 });
  const loud = play(v, { [p('clickvol')]: 100, [p('click')]: 0, [p('clickfreq')]: 87, [clickPar(v, 0)]: 70 });
  const diff = energy(loud.map((x, i) => x - quiet[i])), early = (x) => energy(x.slice(160));
  ok(loud.every(Number.isFinite) && diff > 1e7, `voice ${v}: the click is heard`);
  ok(early(loud.map((x, i) => x - quiet[i])) < diff * 0.01, `voice ${v}: and is over in its LENGTH`);
  for (const sh of [0, 40, 64, 90, 127]) {
    const x = play(v, { [p('clickvol')]: 127, [p('click')]: sh, [p('clickfreq')]: 127, [clickPar(v, 0)]: 127, [clickPar(v, 1)]: 64 });
    ok(x.every((q) => Number.isFinite(q) && Math.abs(q) <= 32768), `voice ${v} shape ${sh}: in range`);
  }
  // a low-pass shut down: the through click is dulled, the direct one is not
  // (the tone into the filter too: the snare's own path, with only its noise filtered, is left for a click that's off)
  const lp = { [extraPar(v, EX.ROUTE_TONE)]: 1, [p('ftype')]: 0, [p('cutoff')]: 0, [p('clickvol')]: 120, [p('click')]: 0, [p('clickfreq')]: 110, [clickPar(v, 0)]: 60 };
  const body = play(v, { ...lp, [p('clickvol')]: 0 }), only = (x) => energy(x.map((q, i) => q - body[i])); // (the click alone)
  const thru = only(play(v, { ...lp, [clickPar(v, 1)]: 0 })), dir = only(play(v, { ...lp, [clickPar(v, 1)]: 127 }));
  ok(dir > 3 * thru, `voice ${v}: DIRECT skips the filter (${(10 * Math.log10(dir / (thru || 1))).toFixed(1)} dB more)`);
}

// old sounds: each click moved onto the new one, lowish; an off click stays off; DIRECT from CLICK IN
const o = oldClick(5, 127, 60, 1);
ok(o.clickvol > 0 && o.clickvol <= 0.3 * 127 + 0.01 && o.clickdir === 0, `an old click comes in lowish (${o.clickvol}) and through the filter`);
ok(oldClick(9, 100, 60, 0).clickdir === 127, 'an old click that skipped the filter is DIRECT');
ok(oldClick(9, 0, 60, 1).clickvol === 0, 'an old click that was off stays off');
ok(BUCKET.every((s) => s.params.clicklen !== undefined && s.params.clickdir !== undefined && s.params.clickvol <= 38.11), 'every bucket sound is on the new click, lowish');
ok(soundClicks(BUCKET[0]) === BUCKET[0], 'a sound on the new click is left as it is');
{
  const s = BUCKET.find((x) => x.params.clickvol > 0), v = s.voice;
  const back = fromVoice(toVoice(s, v), v, { name: 'T', type: s.type });
  ok(back.params.clicklen === s.params.clicklen && back.params.clickdir === s.params.clickdir, 'the bucket keeps LENGTH and DIRECT');
  ok(new Map(toVoice(s, (v + 2) % 6)).get(clickPar((v + 2) % 6, 0)) === s.params.clicklen, 'and they move with the sound to another voice');
}
// an old patch (no clickRule): the base and a key's own click both moved
{
  ok(CLICK_RULE >= 1, 'patches carry the click rule');
  const vals = Float64Array.from(INIT_VALUES.subarray(0, ALL_PARAMS)), p = (u) => ukeyPar(0, u);
  vals[p('click')] = 6; vals[p('clickvol')] = 127; vals[p('clickfreq')] = 30; vals[extraPar(0, EX.ROUTE_CLICK)] = 0;
  const keys = [{ 2: { [p('clickvol')]: 64 } }];
  upgradeClicks(vals, keys);
  const want = oldClick(6, 127, 30, 0), wk = oldClick(6, 64, 30, 0);
  ok(vals[p('clickvol')] === want.clickvol && vals[clickPar(0, 0)] === want.clicklen && vals[clickPar(0, 1)] === 127, 'the base click moved');
  ok(keys[0][2][p('clickvol')] === wk.clickvol && keys[0][2][p('click')] === wk.click, "a key's own click moved too");
}
console.log(`click: ${n} checks pass`);
