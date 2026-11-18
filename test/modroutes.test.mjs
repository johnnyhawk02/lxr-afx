// node test/modroutes.test.mjs: the firmware's LFO and velocity targets as routes on the knobs (sound/schema.js
// upgradeMod). Every kit, its old targets made routes, must play sample for sample as the engine before it played the
// kit with those targets (test/ref), all six voices hit together. Left out on both sides, as upgradeMod leaves them
// out: an LFO aimed at another voice and a target with no knob. Then the store's and presets' keys
// (upgradeMod with keys), and the new sources (the envelopes) move what they're routed to.
import { LxrEngine, BLOCK, SRC, EXTRA_DEST, EX } from '../engine/lxr.js';
import { LxrEngine as RefEngine } from './ref/lxr-ref.js';
import { PAR } from '../engine/lxr-tables.js';
import { parseSnd, upgradeMod, routeOf, modOf, MOD_BASE, ALL_PARAMS, MOD_AMT_ZERO, MOD_TARGETS, NUM_PARAMS, voiceOfTarget, VOICE_SCHEMAS, INIT_VALUES, SOUNDS } from '../sound/schema.js';
import { kitToFirmware } from '../engine/lxr.js';
import { KIT_FILES } from '../sound/kits.js';
let fails = 0, checks = 0;
const ok = (c, m) => { checks++; if (!c) { fails++; console.log('FAIL', m); } };

const WAVES = ['OSC_WAVE_DRUM1', 'OSC_WAVE_DRUM2', 'OSC_WAVE_DRUM3', 'MOD_WAVE_DRUM1', 'MOD_WAVE_DRUM2', 'MOD_WAVE_DRUM3', 'OSC_WAVE_SNARE',
  'WAVE1_CYM', 'WAVE2_CYM', 'WAVE3_CYM', 'WAVE1_HH', 'WAVE2_HH', 'WAVE3_HH'].map((n) => PAR[n]);
const routes = (e, values) => { for (let p = MOD_BASE; p < ALL_PARAMS; p++) { const r = routeOf(p); if (r.dest < 0) continue; if (r.src) e.setRouteSrc(r.voice, r.dest, values[p]); else e.setRouteAmt(r.voice, r.dest, (values[p] - MOD_AMT_ZERO) / 127); } };
const dialPar = new Set(VOICE_SCHEMAS.flatMap((sc) => sc.filter((e) => e.mod && e.mod.dest >= 0 && e.mod.dest < EXTRA_DEST).map((e) => e.mod.dest)));
let same = 0, n = 0, kept = 0, dropped = 0;
for (const k of KIT_FILES) {
  const bytes = Uint8Array.from(Buffer.from(k.data, 'base64')), s = parseSnd(bytes);
  // the firmware kit, as the engine before played it: the file's targets, cleaned as parseSnd cleans them
  const raw = kitToFirmware(s.kit.slice(0, NUM_PARAMS));
  for (const p of WAVES) raw[p] %= 6;
  let skip = false;
  for (const p of WAVES) if (bytes[8 + p] > 5) skip = true; // (a user sample wave: see merged.test.mjs)
  if (skip) continue;
  for (let v = 0; v < 6; v++) {
    for (const [d, a] of [['VEL_DEST_' + (v + 1), 'VELO_MOD_AMT_' + (v + 1)], ['TARGET_LFO' + (v + 1), 'AMOUNT_LFO' + (v + 1)]]) {
      let t = bytes[8 + PAR[d]]; if (t >= MOD_TARGETS.length) t = 0;
      const keep = t && voiceOfTarget(t) === v && dialPar.has(MOD_TARGETS[t][1]);
      raw[PAR[d]] = keep ? t : 0; // (left out: see above)
      if (t) { if (keep) kept++; else dropped++; }
    }
  }
  const a = new LxrEngine({ seed: 7 }), b = new RefEngine({ seed: 7 });
  a.loadKit(s.kit); routes(a, s.kit); b.loadKit(raw);
  // (a kit load can leave drum 1's filter drive where a stray NRPN put it; sent again, both engines have it)
  a.setParam(PAR.FILTER_DRIVE_1, raw[PAR.FILTER_DRIVE_1]); b.setParam(PAR.FILTER_DRIVE_1, raw[PAR.FILTER_DRIVE_1]);
  for (const e of [a, b]) for (let v = 0; v < 6; v++) e.trigger(v, 30 + v * 17, 60);
  let d = null;
  for (let blk = 0; blk < 700 && !d; blk++) {
    const oa = a.renderBlock(), ob = b.renderBlock();
    for (let v = 0; v < 6 && !d; v++) for (let i = 0; i < BLOCK; i++) if (oa[v][i] !== ob[v][i]) { d = { v, blk, i }; break; }
  }
  n++; if (!d) same++;
  ok(!d, `${k.file}: voice ${d && d.v} differs at block ${d && d.blk}`);
}
console.log(`kits with their targets as routes: ${same} of ${n} identical (${kept} targets kept, ${dropped} left out)`);

// a key's own target (an old store's key edits): the routes it made, where they differ from the base's
{
  const v = 0, vals = INIT_VALUES.slice();
  vals[PAR.TARGET_LFO1] = MOD_TARGETS.findIndex(([t, p]) => p === PAR.FILTER_FREQ_1); vals[PAR.AMOUNT_LFO1] = 40;
  const keys = SOUNDS.map(() => ({}));
  keys[0][50] = { [PAR.AMOUNT_LFO1]: 90, _o: { [PAR.AMOUNT_LFO1]: 40 } }; // a hand-edited LFO amount
  keys[0][51] = { [PAR.TARGET_LFO1]: MOD_TARGETS.findIndex(([t, p]) => p === PAR.COARSE1), _kit: 'x' }; // its own target
  keys[0][52] = { [PAR.FILTER_FREQ_1]: 9 };
  upgradeMod(vals, keys);
  const cut = modOf(v, 'cutoff'), co = modOf(v, 'coarse');
  ok(vals[cut.src] === SRC.LFO && vals[cut.amt] === MOD_AMT_ZERO + 40 && !vals[PAR.TARGET_LFO1], 'the base: LFO on cutoff, 40');
  ok(keys[0][50][cut.amt] === MOD_AMT_ZERO + 90 && keys[0][50]._o[cut.amt] === MOD_AMT_ZERO + 40 && !(PAR.AMOUNT_LFO1 in keys[0][50]) && !(PAR.AMOUNT_LFO1 in keys[0][50]._o), 'a key with its own amount');
  ok(keys[0][51][cut.src] === 0 && keys[0][51][cut.amt] === MOD_AMT_ZERO && keys[0][51][co.src] === SRC.LFO && keys[0][51][co.amt] === MOD_AMT_ZERO + 40, 'a key with its own target');
  ok(Object.keys(keys[0][52]).length === 1, 'a key with no targets is left alone');
  const again = JSON.stringify([...vals]); upgradeMod(vals, keys); ok(JSON.stringify([...vals]) === again, 'running it again changes nothing');
}

// the envelopes: the amp envelope on the pitch, the pitch envelope on a mod A's gain (an extra)
{
  const run = (src, dest, amt) => {
    const e = new LxrEngine({ seed: 1 }); e.loadInitKit();
    if (src) { e.setRouteSrc(3, dest, src); e.setRouteAmt(3, dest, amt); }
    e.trigger(3, 100, 60); let sum = 0;
    for (let k = 0; k < 200; k++) for (const x of e.renderBlock()[3]) sum += x * x;
    return sum;
  };
  const off = run(0), amp = run(SRC.AMP, PAR.COARSE4, 0.5), neg = run(SRC.AMP, PAR.COARSE4, -0.5);
  ok(amp !== off && neg !== off && amp !== neg, 'the amp envelope moves the pitch, either way');
  const e = new LxrEngine({ seed: 1 }); e.loadInitKit(); e.setExtra(3, EX.A_GAIN, 0);
  e.setRouteSrc(3, EXTRA_DEST + EX.A_GAIN, SRC.PITCH); e.setRouteAmt(3, EXTRA_DEST + EX.A_GAIN, 1);
  e.trigger(3, 100, 60); e.renderBlock(); e.renderBlock();
  ok(e.voices[3].fmModAmount > 0 && e.voices[3].extra[EX.A_GAIN] === 0, 'the pitch envelope moves an extra, and its setting stays');
  e.setRouteSrc(3, EXTRA_DEST + EX.A_GAIN, SRC.OFF);
  ok(e.voices[3].fmModAmount === 0, 'switched off, the extra goes back to its setting');
}
console.log(fails ? `${fails} of ${checks} checks FAILED` : `all ${checks} checks passed`);
process.exit(fails ? 1 : 0);
