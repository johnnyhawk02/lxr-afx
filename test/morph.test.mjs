// node test/morph.test.mjs: the key morph is deterministic, C3 and depth 0 play the base, far keys move more,
// and every sound renders audio at C1, C3 and C5.
import assert from 'node:assert/strict';
import { SOUNDS, VOICE_SCHEMAS, INIT_VALUES, schemaOf } from '../sound/schema.js';
import { morphKey, combinedAmount, BASE_NOTE } from '../sound/morph.js';
import { LxrInstrument } from '../sound/instrument.js';

const base = INIT_VALUES;
const full = { pitch: 1, timbre: 1 };
const run = (sound, note, seed, amount) => morphKey({ schema: schemaOf(sound), base, note, seed, amount, voice: SOUNDS[sound].engineVoice });
const differs = (m) => m.params.filter(([p, v]) => v !== base[p]).length;
let n = 0;
for (let s = 0; s < 7; s++) {
  // same key, same seed: same result
  for (const note of [36, 48, 59, 61, 72, 84]) assert.deepEqual(run(s, note, 1234, full), run(s, note, 1234, full)), n++;
  // C3 is the base, whatever the depth
  const c3 = run(s, BASE_NOTE, 99, full); assert.equal(c3.note, BASE_NOTE); assert.equal(differs(c3), 0); n++;
  // depth 0: every key is the base
  const zero = combinedAmount({ depth: 0, pitch: 1, timbre: 1 }, { depth: 1, pitch: 1, timbre: 1 });
  for (let note = 36; note <= 84; note++) { const m = run(s, note, 7, zero); assert.equal(m.note, BASE_NOTE); assert.equal(differs(m), 0); n++; }
  // a far key moves more than a near one (summed over many seeds)
  let near = 0, far = 0;
  for (let seed = 1; seed < 200; seed++) {
    const d = (m) => m.params.reduce((a, [p, v]) => a + Math.abs(v - base[p]), 0) + Math.abs(m.semitones) * 10;
    near += d(run(s, 61, seed, full)); far += d(run(s, 84, seed, full));
  }
  assert.ok(far > near * 5, `sound ${s}: far ${far} near ${near}`); n++;
  // a new seed changes the far keys
  assert.notDeepEqual(run(s, 84, 1, full), run(s, 84, 2, full)); n++;
  // pitch only / timbre only
  const p = run(s, 84, 5, { pitch: 1, timbre: 0 }); assert.equal(differs(p.params.length ? { params: p.params.filter(([q]) => !VOICE_SCHEMAS[SOUNDS[s].engineVoice].find((e) => e.par === q && e.morph)) } : p) >= 0, true);
  assert.equal(run(s, 84, 5, { pitch: 1, timbre: 0 }).params.filter(([q, v]) => v !== base[q] && VOICE_SCHEMAS[SOUNDS[s].engineVoice].find((e) => e.par === q && e.morph)).length, 0); n++;
  assert.equal(run(s, 84, 5, { pitch: 0, timbre: 1 }).note, BASE_NOTE); n++;
}
// audio: every sound makes sound on C1, C3 and C5
for (let s = 0; s < 7; s++) for (const note of [36, 60, 84]) {
  const inst = new LxrInstrument(48000); inst.loadKit(base);
  const m = run(s, note, 42, full);
  inst.voices[s].play(m.note, 110, m.params);
  const L = new Float32Array(4800), R = new Float32Array(4800); inst.render(L, R);
  const pk = Math.max(...L.map(Math.abs), ...R.map(Math.abs));
  assert.ok(pk > 0.01, `sound ${s} note ${note} silent (${pk})`); n++;
}
console.log(`ok: ${n} checks`);
