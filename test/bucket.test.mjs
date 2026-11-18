// The sound bucket: a kit sound taken out into the bucket plays exactly as the kit sound did, on every engine voice,
// and the bucket holds every distinct kit sound.   node test/bucket.test.mjs
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { parseSnd, mapVoice, VOICE_SCHEMAS } from '../sound/schema.js';
import { fromKit, fromVoice, toVoice, tidy, TYPES } from '../sound/bucket.js';
import { BUCKET } from '../sound/bucket-sounds.js';

const kitDir = new URL('../kits/', import.meta.url);
const files = readdirSync(kitDir, { recursive: true }).filter((f) => /\.snd$/i.test(f)).sort();
const key = (vals) => JSON.stringify([...vals].sort((a, b) => a[0] - b[0]));
let checked = 0;
for (const f of files) {
  const { kit } = parseSnd(readFileSync(new URL(f, kitDir)));
  for (let src = 0; src < 6; src++) {
    const s = fromKit(kit, src, { name: 'X' });
    for (let dst = 0; dst < 6; dst++) { assert.equal(key(toVoice(s, dst)), key(mapVoice(kit, src, dst)), `${f} ${TYPES[src]} on voice ${dst}`); checked++; }
    // back through a voice's values (as the blender saves) and onto the voice again: the same
    const back = fromVoice(toVoice(s, src), src, { name: 'X', type: s.type });
    assert.equal(key(toVoice(back, src)), key(toVoice(s, src)), `${f} ${TYPES[src]} round trip`);
  }
}
// every kit voice is in the bucket (by its from, or as a sound with the same values)
const sig = (s) => `${s.voice}|${JSON.stringify(s.params)}|${s.lfovoice}`, sigs = new Set(BUCKET.map(sig));
for (const f of files) {
  const { kit } = parseSnd(readFileSync(new URL(f, kitDir)));
  for (let src = 0; src < 6; src++) assert.ok(sigs.has(sig(fromKit(kit, src, {}))), `${f} ${TYPES[src]} is in the bucket`);
}
assert.equal(new Set(BUCKET.map((s) => s.name)).size, BUCKET.length, 'every bucket sound has its own name');
// tidy keeps a good sound and refuses junk
assert.deepEqual(toVoice(tidy(BUCKET[0]), 2), toVoice(BUCKET[0], 2));
assert.equal(tidy({ voice: 9, params: { coarse: 1 } }), null);
assert.equal(tidy('nope'), null);
console.log(`bucket: ${checked} kit sounds checked on every voice, ${BUCKET.length} sounds in the bucket: ok`);
