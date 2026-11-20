// The wavetables a voice's tone can play instead of the firmware's waves: TABLE 0 is CLASSIC (the firmware's waves on
// the WAVE dial, as always), 1 to 11 are METAMORF's built-in tables (engine/wavetables.js), made from maths when first
// used. A table is plain data, so the page builds it and posts it to the AudioWorklet, which never builds one while it
// plays (it plays CLASSIC until the table arrives).
import { BUILTINS, need, holds, table, hold, drop, read } from '../engine/wavetables.js?v=mwoj4x4f';

export const TABLE_IDS = [null, ...BUILTINS.map((b) => b[0])];
export const TABLE_NAMES = ['classic', ...BUILTINS.map((b) => b[1].toLowerCase())];
export const tableId = (i) => TABLE_IDS[Math.round(i)] || null;
/** the table to play for TABLE value i (null: CLASSIC). build: make it here if it isn't made yet (false: only one
 *  already held, as the AudioWorklet wants) */
export function tableFor(i, build = true) {
  const id = tableId(i);
  if (!id) return null;
  return build ? need(id) : holds(id) ? table(id) : null;
}
export { hold, holds, drop };

// ---- the shape the tone plays, for the display in the OSC heading: n points of one cycle (-1..1) ----
// TABLE i at WAVE knob position wave (0..WAVE_MAX), pwm the PWM knob (0..127). On CLASSIC, the firmware's waves drawn
// from their formulas (a blend between two neighbours as the dial blends them; noise as seeded steps)
const WAVE_STEP = 25, CLASSIC_WAVES = 6;
export const WAVE_TOP = WAVE_STEP * (CLASSIC_WAVES - 1); // (engine/lxr.js WAVE_MAX: the WAVE dial's top)
function classicAt(k, x, pwm) {
  switch (k) {
    case 0: return Math.sin(2 * Math.PI * x);
    case 1: return x < 0.25 ? 4 * x : x < 0.75 ? 2 - 4 * x : 4 * x - 4;
    case 2: return 1 - 2 * x;
    case 3: return x < 0.5 ? 1 : -1;
    case 4: { const w = pwm / 254; return ((x < w ? 1 : 0) - w) / Math.max(w, 1 - w); } // (a saw minus a saw a PWM/254 cycle on: a pulse that wide)
    default: { let h = Math.imul(Math.floor(x * 16) + 1, 0x9e3779b1); h ^= h >>> 15; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; return ((h >>> 0) / 2147483648 - 1) * 0.9; }
  }
}
export function waveShape(i, wave, pwm = 0, n = 96) {
  const out = new Float32Array(n), t = tableFor(i, true);
  if (t) { const pos = Math.min(Math.max(wave / (WAVE_STEP * (CLASSIC_WAVES - 1)), 0), 1); for (let j = 0; j < n; j++) out[j] = read(t, pos, j / n, 20, 44140); return out; }
  const p = Math.min(Math.max(wave, 0), WAVE_STEP * (CLASSIC_WAVES - 1)) / WAVE_STEP, k = Math.min(Math.floor(p), CLASSIC_WAVES - 2), f = p - k;
  for (let j = 0; j < n; j++) { const a = classicAt(k, j / n, pwm), b = classicAt(k + 1, j / n, pwm); out[j] = a + (b - a) * f; }
  return out;
}
/** how far one frame is along the WAVE knob, for the faint neighbours (0 on CLASSIC: none) */
export const frameStep = (i) => { const t = tableFor(i, true); return t && t.frames > 1 ? WAVE_STEP * (CLASSIC_WAVES - 1) / (t.frames - 1) : 0; };

// ---- TOOLS > ALL KEYS TO WAVETABLE: a CLASSIC wave's place on BASIC, whose frames run sine (0), triangle (10), saw
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
