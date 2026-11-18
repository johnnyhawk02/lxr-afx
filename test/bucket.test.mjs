// The sound bucket: every sound goes onto every engine voice, comes back through the blender's save unchanged, has a
// name of its own, and holds only name, type, voice and params.   node test/bucket.test.mjs
import assert from 'node:assert/strict';
import { fromVoice, toVoice, tidy, TYPES } from '../sound/bucket.js';
import { BUCKET } from '../sound/bucket-sounds.js';

const key = (vals) => JSON.stringify([...vals].sort((a, b) => a[0] - b[0]));
let checked = 0;
for (const s of BUCKET) {
  assert.deepEqual(Object.keys(s).sort(), ['name', 'params', 'type', 'voice'], `${s.name}: only name, type, voice and params`);
  assert.ok(TYPES.includes(s.type), `${s.name}: a known type`);
  for (let v = 0; v < 6; v++) { assert.ok(toVoice(s, v).length > 40, `${s.name} on voice ${v}`); checked++; }
  // saved again from its own voice (as the blender saves): the same sound
  const back = fromVoice(toVoice(s, s.voice), s.voice, { name: s.name, type: s.type });
  assert.equal(key(toVoice(back, s.voice)), key(toVoice(s, s.voice)), `${s.name} round trip`);
  assert.deepEqual(toVoice(tidy(s), 2), toVoice(s, 2), `${s.name} survives tidy`);
}
assert.equal(new Set(BUCKET.map((s) => s.name)).size, BUCKET.length, 'every bucket sound has its own name');
assert.equal(tidy({ voice: 9, params: { coarse: 1 } }), null);
assert.equal(tidy('nope'), null);
console.log(`bucket: ${BUCKET.length} sounds, ${checked} placings on the voices: ok`);
