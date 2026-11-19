// The wavetables every oscillator plays (the tone, MOD A and MOD B; the firmware's waves, CLASSIC, are gone since
// 2026-11-19): 1 to 11 are METAMORF's built-in tables (engine/wavetables.js), 12 and 13 LXR-AFX's own NOISE and DUST,
// made from maths when first used. A table is plain data, so the page builds it and posts it to the AudioWorklet, which
// never builds one while it plays (an oscillator is silent until its table arrives). TABLE 0 was CLASSIC: a patch saved
// then is moved onto tables when it loads (schema.js upgradeTables); a 0 that's left plays BASIC
import { BUILTINS, need, holds, table, hold, drop, read, fromFrames } from '../engine/wavetables.js?v=mwmugadb';
import { NOISE_TABLES } from '../engine/noise-tables.js?v=mwmugadb';

// (then LXR-AFX's own: NOISE and DUST, engine/noise-tables.js, read slower by their div)
export const TABLE_IDS = [null, ...BUILTINS.map((b) => b[0]), ...NOISE_TABLES.map((b) => b[0])];
export const TABLE_NAMES = ['basic', ...BUILTINS.map((b) => b[1].toLowerCase()), ...NOISE_TABLES.map((b) => b[1].toLowerCase())];
const OWN = new Map(NOISE_TABLES.map((b) => [b[0], b]));
function own(id) { if (holds(id)) return table(id); const [, name, frames, div, view] = OWN.get(id), t = fromFrames(id, name, frames()); t.div = div; t.view = view; hold(t); return t; }
export const tableId = (i) => TABLE_IDS[Math.round(i)] || null;
/** the table to play for TABLE value i (0: BASIC). build: make it here if it isn't made yet (false: only one already
 *  held, as the AudioWorklet wants) */
export function tableFor(i, build = true) {
  const id = tableId(i) || 'builtin:basic';
  return build ? (OWN.has(id) ? own(id) : need(id)) : holds(id) ? table(id) : null;
}
export { hold, holds, drop };

// ---- the shape the tone plays, for the display in the OSC heading: n points of one cycle (-1..1) ----
// TABLE i at WAVE knob position wave (0..WAVE_TOP)
const WAVE_STEP = 25, CLASSIC_WAVES = 6; // (the old WAVE dial's steps: what classicPlace below reads)
export const WAVE_TOP = WAVE_STEP * (CLASSIC_WAVES - 1); // (engine/lxr.js WAVE_MAX: the WAVE knob's top)
export function waveShape(i, wave, n = 96) {
  const out = new Float32Array(n), t = tableFor(i, true), pos = Math.min(Math.max(wave / WAVE_TOP, 0), 1) || 0;
  const v = t.view || 1, sub = t.div ? (v < 1 ? 4 : 64) : 1; // (a noise table: a few of its steps, or DUST whole, each point the biggest of several so no click is missed)
  for (let j = 0; j < n; j++) { let m = 0; for (let q = 0; q < sub; q++) { const y = read(t, pos, (j + q / sub) / n * v, 20 / (t.div || 1), 44140); if (Math.abs(y) > Math.abs(m)) m = y; } out[j] = m; }
  return out;
}
/** how far one frame is along the WAVE knob, for the faint neighbours */
export const frameStep = (i) => { const t = tableFor(i, true); return t.frames > 1 ? WAVE_TOP / (t.frames - 1) : 0; };

// ---- a CLASSIC wave's place on BASIC (for upgrading what was saved with CLASSIC), whose frames run sine (0), triangle (10), saw
// (20), square (30), then the square narrowing to a 5% pulse (40), 10 frames between each, as the CLASSIC dial blends.
// The classic PWM wave is a pulse of width PWM/254 of the cycle: its place on the narrowing run. Returns the WAVE knob
// position on BASIC, or null for a wave that has no place on it (noise, or between the pwm wave and noise)
export const BASIC = TABLE_IDS.indexOf('builtin:basic');
export function classicOnBasic(wave, pwm) {
  if (wave > WAVE_TOP - WAVE_STEP + 1e-9) return null;
  const width = pwm / 254, pwmFrame = 30 + Math.min(10, Math.max(0, (0.5 - width) / 0.045));
  const anchors = [0, 10, 20, 30, pwmFrame], p = Math.max(0, wave) / WAVE_STEP, k = Math.min(Math.floor(p), 3), fr = p - k;
  const frame = anchors[k] + (anchors[k + 1] - anchors[k]) * fr;
  return Math.round(frame / 40 * WAVE_TOP * 100) / 100;
}

// a CLASSIC wave's table and place: BASIC (classicOnBasic), or for the noise NOISE at its stepped noise (frame 20 of
// 40, the firmware's noise: a new random level each cycle). A blend between the pwm wave and noise goes to the nearer
export const NOISE = TABLE_IDS.indexOf('lxr:noise'), NOISE_POS = WAVE_TOP / 2;
export const classicPlace = (wave, pwm) => (wave > WAVE_TOP - WAVE_STEP / 2 ? [NOISE, NOISE_POS] : [BASIC, classicOnBasic(Math.min(wave, WAVE_TOP - WAVE_STEP), pwm)]);
// a sound (sound/bucket.js: params by name) moved onto tables (classicPlace): the tone, MOD A and MOD B, each that's
// still on CLASSIC (they share the PWM knob). A sound on tables already comes back as it was (the same object)
export const WAVE_KNOBS = [['wave', 'table'], ['awave', 'atable'], ['bwave', 'btable']];
export function soundToTable(snd) {
  const p = snd.params || {}, q = { ...p };
  let moved = false;
  for (const [w, t] of WAVE_KNOBS) if (!q[t]) { [q[t], q[w]] = classicPlace(q[w] ?? 0, q.pwm ?? 0); moved = true; }
  return moved ? { ...snd, params: q } : snd;
}
