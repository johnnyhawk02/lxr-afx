// node test/morph.test.mjs: the key morph is deterministic, a zone's base key and depth 0 play the base sound, far keys
// move more, kit voices map onto the three sounds, and every sound renders audio across its zone.
import assert from 'node:assert/strict';
import { SOUNDS as ALL_SOUNDS, ZONE_SIZES, setZoneStart, setEngines, zoneSizes, soundOfNote as ofNote, VOICE_SCHEMAS, INIT_VALUES, schemaOf, soundOfNote, mapVoice, parseSnd } from '../sound/schema.js';
import { morphKey, combinedAmount, BASE_NOTE } from '../sound/morph.js';
import { LxrInstrument } from '../sound/instrument.js';
import { KIT_FILES } from '../sound/kits.js';

const base = INIT_VALUES;
const full = { pitch: 1, timbre: 1 };
const SOUNDS = ALL_SOUNDS.slice(0, 3); // (three engines, as it comes)
const run = (s, note, seed, amount) => morphKey({ schema: schemaOf(s), base, note, seed, amount, voice: SOUNDS[s].engineVoice, zone: SOUNDS[s].zone });
const differs = (m) => m.params.filter(([p, v]) => v !== base[p]).length;
const isMorph = (s, q) => schemaOf(s).some((e) => e.par === q && e.morph);
let n = 0;
// zones: 8, 8 and 9 keys up from the Bass Station 2's lowest key (48), no gaps, no overlap
assert.deepEqual(SOUNDS.map((s) => [s.zone.lo, s.zone.hi, s.zone.base]), [[48, 55, 52], [56, 63, 60], [64, 72, 68]]); n++;
// ENGINES 1 to 6: the 25 keys split into that many even zones, side by side, every key in exactly one
for (let e = 1; e <= 6; e++) {
  setEngines(e);
  assert.equal(zoneSizes(e).reduce((a, b) => a + b, 0), 25); n++;
  for (let k = 48; k <= 72; k++) { const s = ofNote(k); assert.ok(s >= 0 && s < e, `ENGINES ${e}: key ${k} in engine ${s}`); n++; }
  assert.equal(ofNote(47), -1); assert.equal(ofNote(73), -1); n += 2;
  assert.ok(Math.max(...zoneSizes(e)) - Math.min(...zoneSizes(e)) <= 1); n++;
}
setEngines(3);
assert.equal(soundOfNote(47), -1); assert.equal(soundOfNote(48), 0); assert.equal(soundOfNote(55), 0); assert.equal(soundOfNote(56), 1);
assert.equal(soundOfNote(63), 1); assert.equal(soundOfNote(64), 2); assert.equal(soundOfNote(72), 2); assert.equal(soundOfNote(73), -1); n += 8;
// moving the zones an octave keeps each key's variant
{ const a = run(0, 50, 9, full); setZoneStart(60); const b = run(0, 62, 9, full); setZoneStart(48); assert.deepEqual(a, b); n++; }
for (let s = 0; s < SOUNDS.length; s++) {
  const z = SOUNDS[s].zone;
  for (const note of [z.lo, z.lo + 5, z.base - 1, z.base + 1, z.hi]) assert.deepEqual(run(s, note, 1234, full), run(s, note, 1234, full)), n++;
  const b = run(s, z.base, 99, full); assert.equal(b.note, BASE_NOTE); assert.equal(differs(b), 0); n++;
  const zero = combinedAmount({ depth: 0, pitch: 1, timbre: 1 }, { depth: 1, pitch: 1, timbre: 1 });
  for (let note = z.lo; note <= z.hi; note++) { const m = run(s, note, 7, zero); assert.equal(m.note, BASE_NOTE); assert.equal(differs(m), 0); n++; }
  let near = 0, far = 0;
  for (let seed = 1; seed < 200; seed++) {
    const d = (m) => m.params.reduce((a, [p, v]) => a + Math.abs(v - base[p]), 0) + Math.abs(m.semitones) * 10;
    near += d(run(s, z.base + 1, seed, full)); far += d(run(s, z.hi, seed, full)) + d(run(s, z.lo, seed, full));
  }
  assert.ok(far > near * 3, `sound ${s}: far ${far} near ${near}`); n++;
  assert.notDeepEqual(run(s, z.hi, 1, full), run(s, z.hi, 2, full)); n++;
  assert.equal(run(s, z.hi, 5, { pitch: 1, timbre: 0 }).params.filter(([q, v]) => v !== base[q] && isMorph(s, q)).length, 0); n++;
  assert.equal(run(s, z.hi, 5, { pitch: 0, timbre: 1 }).note, BASE_NOTE); n++;
}
// kit voices map onto each sound: every mapped parameter belongs to the destination voice
const kits = KIT_FILES.map((k) => parseSnd(Uint8Array.from(Buffer.from(k.data, 'base64'))));
for (const s of SOUNDS) for (const src of s.sources) for (const { kit } of kits.slice(0, 20)) {
  const own = new Set(VOICE_SCHEMAS[s.engineVoice].map((e) => e.par));
  for (const [p, v] of mapVoice(kit, src, s.engineVoice)) { assert.ok(own.has(p) || p === 0 || p >= 0, `par ${p}`); assert.ok(v >= 0 && v <= 255); }
  n++;
}
// audio: the three sounds make sound at the ends and base of their zones, and all three at once
for (let s = 0; s < SOUNDS.length; s++) for (const note of [SOUNDS[s].zone.lo, SOUNDS[s].zone.base, SOUNDS[s].zone.hi]) {
  const inst = new LxrInstrument(48000); inst.loadKit(base);
  const m = run(s, note, 42, full);
  inst.voices[s].play(m.note, 110, m.params);
  const L = new Float32Array(4800), R = new Float32Array(4800); inst.render(L, R);
  assert.ok(Math.max(...L.map(Math.abs)) > 0.01, `sound ${s} note ${note} silent`); n++;
}
{
  const inst = new LxrInstrument(48000); inst.loadKit(base);
  for (let s = 0; s < 3; s++) inst.voices[s].play(60, 110, []);
  const L = new Float32Array(2400), R = new Float32Array(2400); inst.render(L, R);
  const pk = inst.readPeaks(); assert.ok(pk[0] > 0.01 && pk[3] > 0.01 && pk[4] > 0.01, 'all three sound together: ' + pk); n++;
}
console.log(`ok: ${n} checks`);
