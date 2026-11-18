// node test/level.test.mjs: AUTO LEVEL (sound/level.js). Every sound of the built-in kits, measured and trimmed, lands
// at its engine's target (or as near as full scale and the trim's range allow), and the instrument applies a key's
// trim to its own voice only.
import { SOUNDS, INIT_VALUES, PAR, parseSnd, mapVoice, trimPar, trimDb, TRIM_ZERO, VOICE_SCHEMAS, voiceOwned, ALL_PARAMS } from '../sound/schema.js';
import { KIT_FILES } from '../sound/kits.js';
import { measure, trimFor, autoTrim, LEVEL_TARGET_DB } from '../sound/level.js';
import { LxrInstrument } from '../sound/instrument.js';
import { LxrEngine, BLOCK, WAVE_MAX } from '../engine/lxr.js'; // (WAVE_MAX: the noise, last on the wave dial)
let fails = 0, checks = 0;
const ok = (c, m) => { checks++; if (!c) { fails++; console.log('FAIL', m); } };
const kits = KIT_FILES.map((k) => parseSnd(Uint8Array.from(Buffer.from(k.data, 'base64'))));
const q = (a, f) => a[Math.min(a.length - 1, Math.floor(f * a.length))];

// every kit sound of each engine
SOUNDS.forEach((def, sound) => {
  const v = def.engineVoice, target = LEVEL_TARGET_DB[sound], seen = new Set(), before = [], after = [];
  let off = 0, over = 0, near = 0;
  for (const { kit } of kits) for (const src of def.sources) {
    const vals = mapVoice(kit, src, v).filter(([p]) => p !== PAR.VOL1 + v);
    const sig = vals.map(([, x]) => x).join(',');
    if (seen.has(sig)) continue;
    seen.add(sig);
    const m = measure(sound, INIT_VALUES, vals);
    if (!(m.db > -90)) { if (trimFor(sound, m) !== TRIM_ZERO) off++; continue; } // silent: left alone
    const t = trimFor(sound, m), gain = trimDb(t), got = m.db + gain;
    before.push(m.db); after.push(got);
    const capped = m.peak * Math.pow(10, (gain + 0.25) / 20) > 1, atEnd = gain >= 12 || gain <= -16; // a step more would clip; the trim's range
    if (Math.abs(got - target) <= 0.13) near++; else if (!(capped && got < target) && !atEnd) off++;
    if (m.peak * Math.pow(10, gain / 20) > 1.015) over++;
  }
  before.sort((a, b) => a - b); after.sort((a, b) => a - b);
  const n = before.length, in1 = after.filter((x) => Math.abs(x - target) <= 1).length;
  ok(n > 100, `${def.name}: ${n} sounds measured`);
  ok(off === 0, `${def.name}: ${off} sounds off target with no reason`);
  ok(over === 0, `${def.name}: ${over} sounds boosted past full scale`);
  ok(in1 / n > 0.75, `${def.name}: only ${Math.round(100 * in1 / n)}% within 1 dB of the target`);
  ok(Math.abs(q(before, 0.5) - target) <= 0.75, `${def.name}: target ${target} dB is not the kits' median (${q(before, 0.5).toFixed(1)} dB)`);
  const sb = q(before, 0.9) - q(before, 0.1), sa = q(after, 0.9) - q(after, 0.1);
  ok(sb > 10 && sa < 3, `${def.name}: spread before ${sb.toFixed(1)} dB, after ${sa.toFixed(1)} dB`);
});

// the measurement: the same every time, LEVEL makes no difference, a higher note is still measured, silence is left
{ const vals = mapVoice(kits[5].kit, 3, 3), a = measure(1, INIT_VALUES, vals), b = measure(1, INIT_VALUES, vals);
  ok(a.db === b.db && a.peak === b.peak, 'the same sound measures the same twice');
  const quiet = vals.map(([p, x]) => (p === PAR.VOL1 + 3 ? [p, 20] : [p, x]));
  ok(measure(1, INIT_VALUES, quiet).db === a.db, 'a key\'s LEVEL changes its measurement');
  ok(Number.isFinite(measure(1, INIT_VALUES, vals, 72).db), 'a key an octave up is not measured');
  ok(trimFor(0, { db: -Infinity, peak: 0 }) === TRIM_ZERO, 'a silent sound gets a trim');
  ok(autoTrim(1, INIT_VALUES, vals) === trimFor(1, a), 'autoTrim is measure and trimFor'); }

// one voice rendered alone is the voice of the full render (a sound with no noise in it: sample for sample)
{ let same = 0, n = 0;
  for (const kit of kits.slice(0, 16)) {
    const values = INIT_VALUES.slice(0, PAR.NUM_PARAMS); for (const [p, x] of mapVoice(kit.kit, 0, 0)) values[p] = x;
    if (values[PAR.OSC_WAVE_DRUM1] === WAVE_MAX || values[PAR.MOD_WAVE_DRUM1] === WAVE_MAX || values[PAR.WAVE_LFO1] === 5) continue; // noise, or a random LFO: each run differs
    const a = new LxrEngine(), b = new LxrEngine(); a.loadKit(values); b.loadKit(values); a.trigger(0, 100, 60); b.trigger(0, 100, 60);
    let diff = 0;
    for (let i = 0; i < 150; i++) { const x = a.renderBlock()[0], y = b.renderBlock(0)[0]; for (let j = 0; j < BLOCK; j++) if (x[j] !== y[j]) diff++; }
    n++; if (!diff) same++;
  }
  ok(n >= 6 && same === n, `one voice alone matches the full render in ${same} of ${n} drums`); }

// the instrument: a voice's trim scales that voice (6 dB down halves its peak) and no other; it is one of the voice's
// own parameters, so it travels with every note of the key
{ const peaks = (trim) => {
    const inst = new LxrInstrument(48000), L = new Float32Array(480), R = new Float32Array(480);
    inst.play(1, 60, 100, [[trimPar(3), trim]]); inst.play(0, 60, 100, null);
    for (let i = 0; i < 20; i++) inst.render(L, R);
    return inst.readPeaks();
  };
  const p0 = peaks(TRIM_ZERO), p6 = peaks(TRIM_ZERO - 24), up = peaks(TRIM_ZERO + 24);
  ok(p0[3] > 0.01 && Math.abs(p6[3] / p0[3] - Math.pow(10, -6 / 20)) < 0.002, `trim -6 dB: snare peak ${p0[3].toFixed(4)} -> ${p6[3].toFixed(4)}`);
  ok(Math.abs(up[3] / p0[3] - Math.pow(10, 6 / 20)) < 0.01, `trim +6 dB: snare peak ${p0[3].toFixed(4)} -> ${up[3].toFixed(4)}`);
  ok(p0[0] > 0.01 && p6[0] === p0[0], 'the snare\'s trim changed the drum');
  ok(trimDb(TRIM_ZERO) === 0 && trimDb(TRIM_ZERO - 24) === -6, 'trim steps are a quarter of a dB');
  for (const def of SOUNDS) { const v = def.engineVoice;
    ok(voiceOwned(v).includes(trimPar(v)) && trimPar(v) < ALL_PARAMS && INIT_VALUES[trimPar(v)] === TRIM_ZERO, `${def.name}: the trim is not one of its voice's parameters`);
    ok(VOICE_SCHEMAS[v].find((e) => e.par === trimPar(v)).seq === true, `${def.name}: the randomisers could move the trim`); } }

console.log(fails ? `${fails} of ${checks} checks failed` : `ok: ${checks} checks`);
process.exit(fails ? 1 : 0);
