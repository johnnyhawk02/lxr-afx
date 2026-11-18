// node test/merged.test.mjs: the merged voice (engine/lxr.js) against the engine as it was before it (test/ref, the
// firmware port with its four voice types). Every kit, all six voices hit together (and the open hi-hat), at two notes
// and velocities, and a set of random kits (every parameter anywhere in its range), must come out the same, sample for
// sample, voice by voice. (parseSnd makes a kit's LFO and velocity targets routes on its knobs, which the engine before
// didn't have, so here the kits have none: test/modroutes.test.mjs plays them against that engine with their targets.)
import { LxrEngine, BLOCK, kitToPositions, kitToFirmware, toPosition } from '../engine/lxr.js';
import { LxrEngine as RefEngine } from './ref/lxr-ref.js';
import { PAR } from '../engine/lxr-tables.js';
import { parseSnd, mapVoice, INIT_VALUES, EXTRA_BASE, EXTRA_LIVE, NUM_EXTRAS, SOUNDS, voiceOwned, NUM_PARAMS } from '../sound/schema.js';
import { KIT_FILES } from '../sound/kits.js';
let fails = 0, checks = 0;
const ok = (c, m) => { checks++; if (!c) { fails++; console.log('FAIL', m); } };

const BLOCKS = 700; // about a second
// kit: firmware values (the merged engine gets its waves, filter types and FM/MIX modes as knob positions, on their
// detents; edits likewise)
function run(kit, hits, edits = []) {
  const a = new LxrEngine({ seed: 7 }), b = new RefEngine({ seed: 7 });
  a.loadKit(kitToPositions(kit)); b.loadKit(kit);
  // (a kit load no longer leaves drum 1's filter drive where a stray NRPN put it; sent again, both engines have it)
  a.setParam(PAR.FILTER_DRIVE_1, kit[PAR.FILTER_DRIVE_1]); b.setParam(PAR.FILTER_DRIVE_1, kit[PAR.FILTER_DRIVE_1]);
  for (const [v, vel, note] of hits) { a.trigger(v, vel, note); b.trigger(v, vel, note); }
  for (let k = 0; k < BLOCKS; k++) {
    for (const [at, par, val] of edits) if (at === k) { a.setParam(par, toPosition(par, val)); b.setParam(par, val); }
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
const NRPN = [PAR.NRPN_DATA_ENTRY_COARSE, PAR.NRPN_FINE, PAR.NRPN_COARSE];
const WAVE_VOICE = [0, 1, 2, 0, 1, 2, 3, 4, 4, 4, 5, 5, 5];
// (parseSnd gives the knob positions; the firmware values are taken back from them, and a user sample wave from the file)
const kits = KIT_FILES.map((k) => {
  const bytes = Uint8Array.from(Buffer.from(k.data, 'base64')), s = parseSnd(bytes), raw = kitToFirmware(s.kit.slice(0, NUM_PARAMS));
  for (const p of WAVES) if (bytes[8 + p] > 5) raw[p] = bytes[8 + p];
  return { file: k.file, kit: raw, pos: s.kit.slice(0, NUM_PARAMS) };
});
const FILTERS = [1, 2, 3, 4, 5, 6].map((i) => PAR['FILTER_TYPE_' + i]);
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
  for (const p of NRPN) kit[p] = 0; // (a kit load skips the NRPN bytes now, see engine/lxr.js NRPN_PARS)
  for (const p of FILTERS) kit[p] %= 8; // (no unknown filter types: they have no place on the dial)
  for (let i = 0; i < 6; i++) { kit[PAR.VEL_DEST_1 + i] = base[PAR.VEL_DEST_1 + i]; kit[PAR.TARGET_LFO1 + i] = base[PAR.TARGET_LFO1 + i]; kit[PAR.VOICE_LFO1 + i] = base[PAR.VOICE_LFO1 + i]; }
  const edits = Array.from({ length: 20 }, () => [Math.floor(rnd() * BLOCKS), 1 + Math.floor(rnd() * (kit.length - 1)), Math.floor(rnd() * 128)])
    .map(([at, p, v]) => [at, p, WAVES.includes(p) ? v % 6 : FILTERS.includes(p) ? v % 8 : v]).filter(([, p]) => !NRPN.includes(p) && !(p >= PAR.VEL_DEST_1 && p < PAR.VEL_DEST_1 + 6) && !(p >= PAR.TARGET_LFO1 && p < PAR.TARGET_LFO1 + 6) && !(p >= PAR.VOICE_LFO1 && p < PAR.VOICE_LFO1 + 6));
  const d = run(kit, all(1 + Math.floor(rnd() * 127), 36 + Math.floor(rnd() * 48)), edits);
  ok(!d, `random kit ${r}: voice ${d && d.n} differs at block ${d && d.block} sample ${d && d.i} (${d && d.got} vs ${d && d.want})`);
  if (!d) rsame++;
}
console.log(`random kits: ${rsame} of ${R} renders identical`);
// a kit sound dealt onto its own voice through the merged controls (mapVoice: firmware parameters and the voice's
// extras) plays exactly as the kit's voice itself
let dsame = 0, dn = 0;
const apply = (e, par, v) => { if (par >= EXTRA_BASE) { if (EXTRA_LIVE.has(par)) e.setExtra(Math.floor((par - EXTRA_BASE) / NUM_EXTRAS), (par - EXTRA_BASE) % NUM_EXTRAS, v); } else e.setParam(par, v); };
for (const { file, pos: kit } of kits.slice(0, 60)) for (const def of SOUNDS.slice(0, 3)) {
  const v = def.engineVoice, a = new LxrEngine({ seed: 3 }), b = new LxrEngine({ seed: 3 });
  a.loadKit(kit); b.loadKit(kit); // (the other voices as the kit has them: their LFOs may reach this one)
  // a: the voice's own parameters sent again, as the page sends a key's sound (a kit load can leave one as a stray NRPN
  // put it, the firmware's way); b: the same sound through the merged controls
  for (const p of voiceOwned(v)) if (p < NUM_PARAMS) a.setParam(p, kit[p]);
  for (let p = EXTRA_BASE; p < INIT_VALUES.length; p++) apply(b, p, INIT_VALUES[p]);
  for (const [p, x] of mapVoice(kit, v, v)) apply(b, p, x);
  a.trigger(v, 100, 60); b.trigger(v, 100, 60);
  let same = true;
  for (let k = 0; k < 300 && same; k++) { const oa = a.renderBlock(v)[v], ob = b.renderBlock(v)[v]; for (let i = 0; i < BLOCK; i++) if (oa[i] !== ob[i]) { same = false; break; } }
  dn++; if (same) dsame++;
  ok(same, `${file} ${def.name}: dealt through the merged controls, it plays differently`);
}
console.log(`kit sounds dealt onto their own voice: ${dsame} of ${dn} identical`);
// any kit voice dealt onto any engine voice (step 4: every engine plays every kit sound) plays as the kit's voice
// itself, sample for sample. Left out: the kits' LFOs and velocity (they reach voices by number, and an extra can't be
// a target yet) and the hi-hat as a source (it plays as a cymbal with its open decay, by design)
let xsame = 0, xnear = 0, xn = 0;
for (const { file, pos: kit0 } of kits.slice(0, 30)) for (let src = 0; src < 5; src++) for (let dst = 0; dst < 6; dst++) {
  if (src === dst) continue;
  const kit = Uint8Array.from(kit0); for (let i = 1; i <= 6; i++) { kit[PAR['AMOUNT_LFO' + i]] = 0; kit[PAR['VELO_MOD_AMT_' + i]] = 0; kit[PAR['TARGET_LFO' + i]] = 0; kit[PAR['VEL_DEST_' + i]] = 0; }
  const a = new LxrEngine({ seed: 3 }), b = new LxrEngine({ seed: 3 });
  a.loadKit(kit); b.loadKit(kit);
  for (const p of voiceOwned(src)) if (p < NUM_PARAMS) a.setParam(p, kit[p]);
  for (let p = EXTRA_BASE; p < INIT_VALUES.length; p++) apply(b, p, INIT_VALUES[p]);
  for (const [p, x] of mapVoice(kit, src, dst)) apply(b, p, x);
  a.trigger(src, 100, 60); b.trigger(dst, 100, 60);
  let same = true, d2 = 0, e2 = 0;
  for (let k = 0; k < 300; k++) {
    const oa = a.renderBlock(src)[src], ob = b.renderBlock(dst)[dst]; let ra = 0, rb = 0;
    for (let i = 0; i < BLOCK; i++) { if (oa[i] !== ob[i]) same = false; ra += oa[i] * oa[i]; rb += ob[i] * ob[i]; }
    ra = Math.sqrt(ra / BLOCK); rb = Math.sqrt(rb / BLOCK); d2 += (ra - rb) ** 2; e2 += ra * ra;
  }
  const near = Math.sqrt(d2 / (e2 || 1e-12)) < 0.1; // its loudness, block by block, within 10%
  xn++; if (same) xsame++; if (near) xnear++; else if (process.env.SHOWX) console.log('x', file, src, dst);
}
// (where the noise is, the RNG can feed it in another order, so not every one is exact; all but a very few must play
// alike, block by block)
ok(xnear >= xn * 0.99, `kit sounds dealt onto other voices: only ${xnear} of ${xn} alike`);
console.log(`kit sounds dealt onto other voices: ${xsame} of ${xn} identical, ${xnear} alike`);
console.log(fails ? `${fails} of ${checks} checks FAILED` : `all ${checks} checks passed`);
process.exit(fails ? 1 : 0);
