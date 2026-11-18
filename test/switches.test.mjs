// node test/switches.test.mjs: the morphable switches (engine/lxr.js WAVE_STEP): the oscillator waves, the filter types
// and mod A's FM/MIX mode as knobs. On a detent a sound plays as the menu setting did (test/merged.test.mjs checks that
// against the firmware port); here, between two detents the sound moves smoothly from one to the other: one step off a
// detent is close to the detent, the halfway point lies between the two ends, and nothing blows up.
import { LxrEngine, BLOCK, WAVE_STEP, WAVE_MAX, FILTER_STEP, FILTER_MAX, MODE_MAX, EX, SRC } from '../engine/lxr.js';
import { PAR } from '../engine/lxr-tables.js';
import { parseSnd, mapVoice } from '../sound/schema.js';
import { KIT_FILES } from '../sound/kits.js';
let fails = 0, checks = 0;
const ok = (c, m) => { checks++; if (!c) { fails++; console.log('FAIL', m); } };
const kits = KIT_FILES.map((k) => parseSnd(Uint8Array.from(Buffer.from(k.data, 'base64'))).kit);

// one voice of a kit, with some controls set, rendered for n blocks
function render(kit, v, set, n = 120) {
  const e = new LxrEngine({ seed: 5 });
  e.loadKit(kit);
  set(e);
  e.trigger(v, 110, 60);
  const out = new Float64Array(n * BLOCK);
  for (let k = 0; k < n; k++) { const o = e.renderBlock(v)[v]; for (let i = 0; i < BLOCK; i++) out[k * BLOCK + i] = o[i]; }
  return out;
}
const rms = (a) => Math.sqrt(a.reduce((s, x) => s + x * x, 0) / a.length);
const diff = (a, b) => rms(a.map((x, i) => x - b[i]));
const finite = (a) => a.every((x) => Number.isFinite(x) && Math.abs(x) <= 32768);

// each pair of neighbouring detents, on a few kit sounds: drum (voice 0), snare (3), cymbal (4). The dial is set the way
// a modulator sets it (a float position), so it can sit a hair off a detent: there it must sound all but the same as on
// the detent (no jump in level, phase or pitch as a blend starts). (Further along, a blend in front of the drive, the FM
// or the noise moves the sound quickly: that's the sound, not a jump, so only the level is checked there.)
// (with the voice's drive off: a drive near full turns even a whisper into a full-scale square, so a blend that starts
// from a silent detent, PWM at width 0, jumps there)
const NO_DRIVE = new LxrEngine().voices[0].distortion.shape;
function sweep(name, step, max, par, voices, prep0 = () => {}, noisy = () => false) {
  const prep = (e, v) => { prep0(e, v); e.voices[v].distortion.shape = NO_DRIVE; };
  let worst = 0;
  for (const [kitNo, v] of voices) {
    const kit = kits[kitNo], P = par(v);
    if (P === undefined) continue;
    for (let k = 0; k + step <= max; k += step) {
      const at = (x) => render(kit, v, (e) => { prep(e, v); e._dispatch(P, 0, true, x / 127); });
      const a = at(k), a1 = at(k + 0.02), mid = at(k + step / 2), b1 = at(k + step - 0.02), b = at(k + step);
      ok(finite(a1) && finite(mid) && finite(b1), `${name} ${k}..${k + step} voice ${v}: a sample out of range`);
      ok(rms(mid) <= 2 * Math.max(rms(a), rms(b)) + 200, `${name} ${k}..${k + step} voice ${v}: halfway is far louder than both ends`);
      const span = diff(a, b);
      if (span < 50) continue; // (the two detents sound the same here: nothing to blend)
      const near = noisy(k, step) ? Math.max(Math.abs(rms(a) - rms(a1)), Math.abs(rms(b) - rms(b1))) / Math.max(rms(a), rms(b), 1)
        : Math.max(diff(a, a1), diff(b, b1)) / span;
      worst = Math.max(worst, near);
      ok(near < (noisy(k, step) ? 0.1 : 0.05), `${name} ${k}..${k + step} voice ${v}: a hair off a detent sounds ${(near * 100).toFixed(1)}% different`);
    }
  }
  console.log(`${name}: a hair off a detent sounds at most ${(worst * 100).toFixed(2)}% different`);
}
const VOICES = [[0, 0], [3, 0], [5, 3], [7, 4], [12, 0], [20, 5]];
const noiseEnd = (k, step) => k + step >= WAVE_MAX; // (the pair with the noise: a hair's change of pitch moves its random steps)
sweep('osc wave', WAVE_STEP, WAVE_MAX, (v) => (v < 3 ? PAR.OSC_WAVE_DRUM1 + v : [PAR.OSC_WAVE_SNARE, PAR.WAVE1_CYM, PAR.WAVE1_HH][v - 3]), VOICES, () => {}, noiseEnd);
sweep('mod A wave', WAVE_STEP, WAVE_MAX, (v) => (v < 3 ? PAR.MOD_WAVE_DRUM1 + v : [undefined, PAR.WAVE2_CYM, PAR.WAVE2_HH][v - 3]), VOICES, () => {}, noiseEnd);
sweep('filter', FILTER_STEP, FILTER_MAX, (v) => PAR['FILTER_TYPE_' + (v + 1)], VOICES);
sweep('fm/mix', MODE_MAX, MODE_MAX, (v) => (v < 3 ? PAR.MIX_MOD_1 + v : undefined), VOICES, (e, v) => e.setParam(PAR['FMAMNT' + (v + 1)], 80));

// an LFO on a dial from between two detents sweeps along it (and stays in range)
{
  const kit = Uint8Array.from(kits[0]);
  const e = new LxrEngine({ seed: 9 });
  e.loadKit(kit);
  e.setParam(PAR.OSC_WAVE_DRUM1, 40);
  e.setRouteSrc(0, PAR.OSC_WAVE_DRUM1, SRC.LFO);
  e.setRouteAmt(0, PAR.OSC_WAVE_DRUM1, 0.5);
  e.trigger(0, 120, 60);
  const seen = new Set();
  let good = true;
  for (let k = 0; k < 400; k++) { const o = e.renderBlock(0)[0]; for (const x of o) if (!Number.isFinite(x)) good = false; seen.add(e.voices[0].osc.waveform + ':' + e.voices[0].osc.wB); }
  ok(good, 'LFO on the wave: bad samples');
  ok(seen.size > 2, `LFO on the wave from between two detents: it should move along the dial (saw ${[...seen]})`);
}
console.log(fails ? `${fails} of ${checks} checks FAILED` : `all ${checks} checks passed`);
process.exit(fails ? 1 : 0);
