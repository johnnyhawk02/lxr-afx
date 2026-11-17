// AUTO LEVEL: how loud a key's sound is, measured by playing it offline through the engine, and the correction that
// brings it to its engine's target. The randomisers (NEW SOUND, SCATTER, ALTER) deal sounds of very different
// loudness; with the correction every key of an engine lands at about the same level.
//
// Loudness is the loudest 100 ms of the hit (velocity 100, the voice's LEVEL at full, at the key's pitch), K-weighted as in ITU-R
// BS.1770 (a high-pass that takes out the sub rumble the ear hardly counts, and a shelf that lifts the presence
// range it counts most), in dB below digital full scale. The correction is kept on the key as its TRIM (trimPar in
// schema.js), a gain of its own that the instrument applies to the voice: the LEVEL knob stays yours.
import { LxrEngine, REAL_FS, BLOCK } from '../engine/lxr.js';
import { SOUNDS, NUM_PARAMS, PAR, TRIM_ZERO, TRIM_STEP_DB } from './schema.js?v=mwkzygyc';

// each engine's target: the middle (median) loudness of all its sounds in the built-in kits, so a typical kit sound
// plays as it always did and the drums, snares and metals keep the balance the kits were made with
export const LEVEL_TARGET_DB = [-17.0, -11.5, -16.0]; // drum, snare, metal (measured by tools/levels.mjs)
// a hit is played for 0.4 s; a sound still swelling then (a slow attack) is followed until it stops, 1.5 s at most
const MAX_BOOST_DB = 12, MAX_CUT_DB = 16, WINDOW = Math.round(0.1 * REAL_FS / BLOCK), BLOCKS = Math.round(0.4 * REAL_FS / BLOCK),
  MAX_BLOCKS = Math.round(1.5 * REAL_FS / BLOCK);

// a biquad (RBJ cookbook), direct form 1
function biquad(b0, b1, b2, a0, a1, a2) {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
  return (x) => { const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x; y2 = y1; y1 = y; return y; };
}
// the K weighting at the engine's rate: a +4 dB shelf above about 1.7 kHz, then a 38 Hz high-pass
function kWeight() {
  const A = Math.pow(10, 4 / 40), w = 2 * Math.PI * 1682 / REAL_FS, c = Math.cos(w), al = Math.sin(w) / 2 * Math.SQRT2, sq = 2 * Math.sqrt(A) * al;
  const shelf = biquad(A * ((A + 1) + (A - 1) * c + sq), -2 * A * ((A - 1) + (A + 1) * c), A * ((A + 1) + (A - 1) * c - sq),
    (A + 1) - (A - 1) * c + sq, 2 * ((A - 1) - (A + 1) * c), (A + 1) - (A - 1) * c - sq);
  const wh = 2 * Math.PI * 38 / REAL_FS, ch = Math.cos(wh), ah = Math.sin(wh) / (2 * 0.5);
  const hp = biquad((1 + ch) / 2, -(1 + ch), (1 + ch) / 2, 1 + ah, -2 * ch, 1 - ah);
  return (x) => hp(shelf(x));
}

/**
 * How loud a sound is. sound: 0 drum, 1 snare, 2 metal; kit: every parameter's value (the engine's base); vals: the
 * key's own values over it, [[parameter, value], ...] or a Map; note: the note the key plays it at (60 is the sound's
 * own pitch). Returns { db, peak }: the loudest 100 ms, K-weighted, in dB below full scale, and the highest sample
 * (0..1). A silent sound gives db -Infinity.
 */
export function measure(sound, kit, vals, note = 60) {
  const def = SOUNDS[sound], v = def.engineVoice, values = new Uint8Array(NUM_PARAMS);
  values.set(kit.subarray ? kit.subarray(0, NUM_PARAMS) : kit.slice(0, NUM_PARAMS));
  for (const [p, x] of vals) if (p < NUM_PARAMS) values[p] = x;
  values[PAR.VOL1 + v] = 127; // the sound itself, whatever its LEVEL
  const e = new LxrEngine();
  e.loadKit(values);
  e.trigger(def.trigger, 100, note);
  const k = kWeight(), energy = new Float64Array(MAX_BLOCKS);
  let peak = 0, win = 0, best = 0;
  for (let b = 0; b < MAX_BLOCKS; b++) {
    if (b >= BLOCKS && !(win > best / 2)) break; // past the usual length only while it is still about as loud as it got
    const o = e.renderBlock(v)[v]; // this voice alone
    let sum = 0;
    for (let i = 0; i < BLOCK; i++) { const x = o[i] / 32768, y = k(x), a = x < 0 ? -x : x; sum += y * y; if (a > peak) peak = a; }
    energy[b] = sum; win += sum;
    if (b >= WINDOW) win -= energy[b - WINDOW];
    if (win > best) best = win;
  }
  return { db: best > 0 ? 10 * Math.log10(best / (WINDOW * BLOCK)) : -Infinity, peak };
}

/** the TRIM value (0..127, TRIM_ZERO is no correction) that brings a measured sound to its engine's target: never a
 *  boost past full scale, never more than 12 dB up or 16 dB down; a silent sound is left alone */
export function trimFor(sound, m) {
  if (!(m.db > -90)) return TRIM_ZERO;
  let db = LEVEL_TARGET_DB[sound] - m.db;
  if (m.peak > 0) db = Math.min(db, -20 * Math.log10(m.peak)); // the boost that would take its peak to full scale
  db = Math.max(-MAX_CUT_DB, Math.min(MAX_BOOST_DB, db));
  return Math.max(0, Math.min(127, TRIM_ZERO + Math.round(db / TRIM_STEP_DB)));
}
export const autoTrim = (sound, kit, vals, note) => trimFor(sound, measure(sound, kit, vals, note));
