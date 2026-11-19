// node test/switches.test.mjs: the morphable switches (engine/lxr.js WAVE_STEP): the oscillator waves, the filter types
// and mod A's FM/MIX mode as knobs. On a detent a sound plays as the menu setting did (test/merged.test.mjs checks that
// against the firmware port); here, between two detents the sound moves smoothly from one to the other: one step off a
// detent is close to the detent, the halfway point lies between the two ends, and nothing blows up.
import { LxrEngine, BLOCK, WAVE_STEP, WAVE_MAX, FILTER_STEP, FILTER_MAX, MODE_MAX, EX, SRC, FILTER_PROBE } from '../engine/lxr.js';
import { PAR } from '../engine/lxr-tables.js';
import { mapVoice } from '../sound/schema.js';
import { KITS } from './bucket-kits.mjs';
let fails = 0, checks = 0;
const ok = (c, m) => { checks++; if (!c) { fails++; console.log('FAIL', m); } };
const kits = KITS.map((k) => k.kit);

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

// turning the filter type dial while a note holds: no zipper (the blend glides over each block, so the steps between
// samples at the block edges are no bigger than inside the blocks), and a blend into LP2 or out of it starts from a warm
// filter (close to where it settles)
{
  const play = (path, reso, cut, n) => {
    const v = { filter: FILTER_PROBE.make(), filterType: 0, filterB: 0, filterT: 0, fwTo: null, fwAt: null, fFirm: 0 };
    FILTER_PROBE.setReso(v.filter, reso); FILTER_PROBE.setCutoff(v.filter, cut);
    let ph = 0; const a = [];
    for (let k = 0; k < n; k++) {
      FILTER_PROBE.setPos(v, path(k));
      const buf = new Int16Array(BLOCK);
      for (let i = 0; i < BLOCK; i++) { ph = (ph + 0.0123) % 1; buf[i] = Math.round((Math.sin(2 * Math.PI * ph) + 0.4 * Math.sin(6 * Math.PI * ph + 1)) * 12000); }
      FILTER_PROBE.block(v, buf); a.push(...buf);
    }
    return a;
  };
  for (const reso of [0.2, 0.8]) for (const cut of [0.15, 0.6]) for (const [name, path] of [['turned', (k) => Math.min(FILTER_MAX, k >> 1)], ['wiggled', (k) => ((k >> 3) % 2 ? 100 : 95)]]) {
    const a = play(path, reso, cut, 2 * FILTER_MAX + 10);
    let sb = 0, nb = 0, si = 0, ni = 0;
    for (let i = 1; i < a.length; i++) { const d = Math.abs(a[i] - a[i - 1]); if (i % BLOCK === 0) { sb += d; nb++; } else { si += d; ni++; } }
    const z = (sb / nb) / (si / ni);
    ok(z < 1.03, `filter dial ${name} (reso ${reso}, cutoff ${cut}): steps at block edges ${z.toFixed(2)}x the others (zipper)`);
  }
  for (const [w, x, y] of [[108, 90, 97], [0, 108, 100], [108, 0, 100]]) { // (w first: what the filter not playing at x last held)
    // (from the block after the move: the move itself glides over one block)
    const moved = play((k) => (k < 100 ? w : k < 200 ? x : y), 0.5, 0.02, 205).slice(201 * BLOCK), sat = play(() => y, 0.5, 0.02, 205).slice(201 * BLOCK);
    const err = rms(moved.map((m, i) => m - sat[i])) / rms(sat);
    ok(err < 0.05, `filter dial ${w}, ${x} -> ${y}: ${(err * 100).toFixed(1)}% off where it settles (a cold filter)`);
  }
}

// an LFO on a dial from between two detents sweeps along it (and stays in range)
{
  const kit = Uint8Array.from(kits[0]);
  const e = new LxrEngine({ seed: 9 });
  e.loadKit(kit);
  e.setParam(PAR.OSC_WAVE_DRUM1, 40);
  e.setParam(PAR.SYNC_LFO1, 0); e.setParam(PAR.FREQ_LFO1, 90); e.setParam(PAR.WAVE_LFO1, 0); // (an LFO fast enough to see move, whatever the kit had)
  e.setRouteAmt(0, PAR.OSC_WAVE_DRUM1, SRC.LFO, 0.5);
  e.trigger(0, 120, 60);
  const seen = new Set();
  let good = true;
  for (let k = 0; k < 400; k++) { const o = e.renderBlock(0)[0]; for (const x of o) if (!Number.isFinite(x)) good = false; seen.add(e.voices[0].osc.waveform + ':' + e.voices[0].osc.wB); }
  ok(good, 'LFO on the wave: bad samples');
  ok(seen.size > 2, `LFO on the wave from between two detents: it should move along the dial (saw ${[...seen]})`);
}
console.log(fails ? `${fails} of ${checks} checks FAILED` : `all ${checks} checks passed`);
process.exit(fails ? 1 : 0);
