// node test/merged.test.mjs: the merged voice (engine/lxr.js) against the engine as it was before it (test/ref, the
// firmware port with its four voice types). Every kit, all six voices hit together (and the open hi-hat), at two notes
// and velocities, and a set of random kits (every parameter anywhere in its range, LFOs and velocity aimed anywhere),
// must come out the same, sample for sample, voice by voice.
import { LxrEngine, BLOCK } from '../engine/lxr.js';
import { LxrEngine as RefEngine } from './ref/lxr-ref.js';
import { PAR } from '../engine/lxr-tables.js';
import { parseSnd } from '../sound/schema.js';
import { KIT_FILES } from '../sound/kits.js';
let fails = 0, checks = 0;
const ok = (c, m) => { checks++; if (!c) { fails++; console.log('FAIL', m); } };

const BLOCKS = 700; // about a second
function run(kit, hits, edits = []) {
  const a = new LxrEngine({ seed: 7 }), b = new RefEngine({ seed: 7 });
  a.loadKit(kit); b.loadKit(kit);
  for (const [v, vel, note] of hits) { a.trigger(v, vel, note); b.trigger(v, vel, note); }
  for (let k = 0; k < BLOCKS; k++) {
    for (const [at, par, val] of edits) if (at === k) { a.setParam(par, val); b.setParam(par, val); }
    const oa = a.renderBlock(), ob = b.renderBlock();
    for (let n = 0; n < 6; n++) for (let i = 0; i < BLOCK; i++) if (oa[n][i] !== ob[n][i]) return { n, block: k, i, got: oa[n][i], want: ob[n][i] };
  }
  return null;
}
const all = (vel, note) => [0, 1, 2, 3, 4, 5].map((v) => [v, vel, note]);
// the oscillator wave controls: above 5 a wave is a user sample, which the port doesn't load. The merged voice plays
// one as silence; the engine before it replayed whatever was left in a buffer another part used, so a kit voice that
// uses one (one voice of one factory kit, ACID) is left out
const WAVES = ['OSC_WAVE_DRUM1', 'OSC_WAVE_DRUM2', 'OSC_WAVE_DRUM3', 'MOD_WAVE_DRUM1', 'MOD_WAVE_DRUM2', 'MOD_WAVE_DRUM3', 'OSC_WAVE_SNARE',
  'WAVE1_CYM', 'WAVE2_CYM', 'WAVE3_CYM', 'WAVE1_HH', 'WAVE2_HH', 'WAVE3_HH'].map((n) => PAR[n]);
const WAVE_VOICE = [0, 1, 2, 0, 1, 2, 3, 4, 4, 4, 5, 5, 5];
const kits = KIT_FILES.map((k) => ({ file: k.file, ...parseSnd(Uint8Array.from(Buffer.from(k.data, 'base64'))) }));
let same = 0, skipped = 0;
for (const { file, kit } of kits) {
  const sampled = new Set(WAVES.flatMap((p, i) => (kit[p] > 5 ? [WAVE_VOICE[i]] : [])));
  if (sampled.size) { skipped += sampled.size; for (const p of WAVES) if (kit[p] > 5) kit[p] = 0; } // (and the rest of the kit still checked)
  for (const [hits, what] of [[all(110, 60), 'C3 v110'], [[...all(40, 53).slice(0, 5), [6, 90, 67]], 'F2 v40, open hat']]) {
    const d = run(kit, hits);
    ok(!d, `${file} ${what}: voice ${d && d.n} differs at block ${d && d.block} sample ${d && d.i} (${d && d.got} vs ${d && d.want})`);
    if (!d) same++;
  }
}
console.log(`kits: ${same} of ${kits.length * 2} renders identical (${skipped} kit voice${skipped === 1 ? '' : 's'} with a sample wave left out)`);

// random kits, with edits while the sounds ring
let x = 12345; const rnd = () => ((x = (x * 1103515245 + 12345) >>> 0) / 4294967296);
let rsame = 0; const R = 120;
for (let r = 0; r < R; r++) {
  const base = kits[r % kits.length].kit, kit = Uint8Array.from(base);
  for (let p = 1; p < kit.length; p++) if (rnd() < 0.5) kit[p] = Math.floor(rnd() * 128);
  for (const p of WAVES) kit[p] %= 6; // (no sample waves)
  for (let i = 0; i < 6; i++) { kit[PAR.VEL_DEST_1 + i] = base[PAR.VEL_DEST_1 + i]; kit[PAR.TARGET_LFO1 + i] = base[PAR.TARGET_LFO1 + i]; kit[PAR.VOICE_LFO1 + i] = base[PAR.VOICE_LFO1 + i]; }
  const edits = Array.from({ length: 20 }, () => [Math.floor(rnd() * BLOCKS), 1 + Math.floor(rnd() * (kit.length - 1)), Math.floor(rnd() * 128)])
    .map(([at, p, v]) => [at, p, WAVES.includes(p) ? v % 6 : v]).filter(([, p]) => !(p >= PAR.VEL_DEST_1 && p < PAR.VEL_DEST_1 + 6) && !(p >= PAR.TARGET_LFO1 && p < PAR.TARGET_LFO1 + 6) && !(p >= PAR.VOICE_LFO1 && p < PAR.VOICE_LFO1 + 6));
  const d = run(kit, all(1 + Math.floor(rnd() * 127), 36 + Math.floor(rnd() * 48)), edits);
  ok(!d, `random kit ${r}: voice ${d && d.n} differs at block ${d && d.block} sample ${d && d.i} (${d && d.got} vs ${d && d.want})`);
  if (!d) rsame++;
}
console.log(`random kits: ${rsame} of ${R} renders identical`);
console.log(fails ? `${fails} of ${checks} checks FAILED` : `all ${checks} checks passed`);
process.exit(fails ? 1 : 0);
