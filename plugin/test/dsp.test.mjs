// The plugin's DSP script (build/dsp.js, run in JavaScriptCore by the plugin) checked in node, or in bun (which is
// JavaScriptCore too: `bun plugin/test/dsp.test.mjs`): notes from the DAW through the key table sound exactly as
// the page's own 'play' messages do, and print a hash of the output to compare between the two engines.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SOUNDS, INIT_VALUES, ALL_PARAMS } from '../../sound/schema.js';
import { BUCKET } from '../../sound/bucket-sounds.js';
import { toVoice } from '../../sound/bucket.js';

const src = fs.readFileSync(fileURLToPath(new URL('../build/dsp.js', import.meta.url)), 'utf8');
function load() { const g = {}; new Function('globalThis', src)(g); return g.lxr; }
const SR = 48000, N = 128;
function run(viaMidi) {
  const lxr = load(), L = new Float32Array(2048), R = new Float32Array(2048);
  lxr.init(SR, L, R);
  const values = Array.from(INIT_VALUES.subarray(0, ALL_PARAMS));
  lxr.msg(JSON.stringify({ type: 'engines', n: 3 }));
  lxr.msg(JSON.stringify({ type: 'kit', values }));
  // three keys with bucket sounds, one per zone
  const table = [];
  SOUNDS.slice(0, 3).forEach((s, i) => { const snd = BUCKET[i * 40 + 5], p = toVoice(snd, s.engineVoice); table.push([s.zone.base, i, 60, p]); });
  lxr.msg(JSON.stringify({ type: 'keys', full: true, keys: table }));
  let h = 0x811c9dc5, energy = 0;
  for (let b = 0; b < 1500; b++) {
    if (b % 100 === 0) {
      const [note, sound, play, params] = table[(b / 100) % 3];
      if (viaMidi) { lxr.midi(0x90, note, 100); } else lxr.msg(JSON.stringify({ type: 'play', sound, note: play, vel: 100, params, hold: true, glide: true }));
    }
    if (b % 100 === 50) { const [note, sound] = table[((b - 50) / 100) % 3]; if (viaMidi) lxr.midi(0x80, note, 0); else lxr.msg(JSON.stringify({ type: 'release', sound })); }
    lxr.render(N);
    for (let i = 0; i < N; i++) { energy += L[i] * L[i]; h = Math.imul(h ^ (Math.round(L[i] * 32767) & 0xffff), 0x01000193) >>> 0; }
    if (b % 7 === 0) lxr.poll();
  }
  return { h: h.toString(16), energy };
}
const a = run(true), b = run(false);
console.log(`via MIDI ${a.h} (energy ${a.energy.toFixed(1)}), via page ${b.h}`);
const lxr = load(), L = new Float32Array(2048), R = new Float32Array(2048); lxr.init(SR, L, R);
for (let i = 0; i < 400; i++) lxr.render(N);
const p = JSON.parse(lxr.poll() || 'null');
if (a.h !== b.h || !(a.energy > 1) || !p || p.type !== 'peaks' || !Array.isArray(p.peaks)) { console.log('FAIL', p && Object.keys(p)); process.exit(1); }
console.log('dsp: ok');
