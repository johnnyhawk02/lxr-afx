// Every bucket sound plays sample for sample as it did when the hashes were taken: on its own voice and on one other,
// at three notes. Guards the knobs' move to decimals (a whole-number value must sound exactly as before).
//   node test/golden.test.mjs          check
//   node test/golden.test.mjs --save   take the hashes again (only when a change of sound is meant)
import fs from 'node:fs';
import { LxrInstrument } from '../sound/instrument.js';
import { SOUNDS, INIT_VALUES, ALL_PARAMS } from '../sound/schema.js';
import { BUCKET } from '../sound/bucket-sounds.js';
import { toVoice } from '../sound/bucket.js';

const FILE = new URL('./golden/hashes.json', import.meta.url), BLOCKS = 200, NOTES = [48, 60, 67];
const save = process.argv.includes('--save');
function hashSound(snd, v) {
  const sound = SOUNDS.findIndex((s) => s.engineVoice === v);
  let h = 0x811c9dc5;
  for (const note of NOTES) {
    const inst = new LxrInstrument(44140), vals = Float64Array.from(INIT_VALUES.subarray(0, ALL_PARAMS));
    for (const [p, x] of toVoice(snd, v)) vals[p] = x;
    inst.loadKit(vals);
    for (const [p, x] of toVoice(snd, v)) inst.setParam(p, x);
    inst.e.trigger(SOUNDS[sound].trigger, 100, note);
    for (let b = 0; b < BLOCKS; b++) { const o = inst.e.renderBlock(v)[v]; for (let i = 0; i < o.length; i++) h = Math.imul(h ^ (o[i] & 0xffff), 0x01000193) >>> 0; }
  }
  return h.toString(16);
}
const routed = (s) => Object.keys(s.params).some((k) => k.startsWith('mod:') && s.params[k] !== 127);
const got = {};
for (const s of BUCKET) got[s.name] = [hashSound(s, s.voice), hashSound(s, (s.voice + 3) % 6)];
if (save) { fs.writeFileSync(FILE, JSON.stringify(got, null, 0) + '\n'); console.log(`saved ${Object.keys(got).length} sounds`); process.exit(0); }
const want = JSON.parse(fs.readFileSync(FILE, 'utf8'));
const diff = Object.keys(want).filter((n) => got[n] && got[n].join() !== want[n].join());
const plain = diff.filter((n) => !routed(BUCKET.find((s) => s.name === n)));
console.log(`golden: ${Object.keys(want).length} sounds, ${diff.length} differ (${diff.length - plain.length} of them use modulation)`);
if (plain.length) { console.log('changed without modulation:', plain.slice(0, 20).join(', ')); process.exit(1); }
if (diff.length && !process.argv.includes('--allow-mod')) process.exit(1);
