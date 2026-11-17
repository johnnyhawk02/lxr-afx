// The key morph (AFX style): every key but C3 plays a variant of its sound's base.
// Pure functions of integers and the base values: no state, no DOM, no Math.random, so a port to C++ gives the same
// result. The same seed, key and base always make the same variant.
//
//   morphKey({ schema, base, note, seed, amount }) -> { note, params }
//     schema  the sound's parameter schema (schema.js)
//     base    the kit's parameter values (indexed by parameter number); the morph never changes them
//     note    the MIDI note played (C3 = 60 plays the base)
//     seed    the sound's 32-bit seed
//     amount  { pitch, timbre }: the combined depths, 0..1 each (global depth x sound depth x global x sound slider)
//     voice   the engine voice (for its fine tune parameter)
//   returns the note the engine is triggered with and the [parameter, value] pairs to send before the trigger
import { pitchPars } from './schema.js';

export const BASE_NOTE = 60; // C3 (Novation / Ableton naming: C3 = MIDI 60)
export const LOW_NOTE = 36; // C1
export const HIGH_NOTE = 84; // C5
export const MAX_PITCH = 12; // semitones either way at the far ends of the keyboard, at full depth

// a 32-bit hash of three integers (murmur3's finaliser over a mix of them)
export function hash3(a, b, c) {
  let h = Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca77) ^ Math.imul(c | 0, 0xc2b2ae3d);
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}
// a value in -1..1 from the seed, the key and what it's for (a parameter number, or one of the salts below)
export const unit = (seed, note, salt) => hash3(seed, note, salt) / 2147483648 - 1;
const SALT_PITCH = 1000, SALT_FINE = 1001;

// how far a key is from C3, 0..1 (C1 and C5 are 1), and which side (-1 below, 1 above, 0 on C3)
export function keyDistance(note) {
  const d = (note - BASE_NOTE) / (HIGH_NOTE - BASE_NOTE);
  return { dist: Math.min(1, Math.abs(d)), side: Math.sign(d) };
}

// the pitch offset of a key, in semitones: half the way it leans with the keyboard (higher keys tend higher), half its
// own random amount either way, scaled by its distance and the depth
export function pitchOffset(note, seed, pitch) {
  const { dist, side } = keyDistance(note);
  if (!dist || !pitch) return 0;
  return MAX_PITCH * pitch * dist * (0.5 * side + 0.5 * unit(seed, note, SALT_PITCH));
}

export function morphKey({ schema, base, note, seed, amount, voice }) {
  const { dist } = keyDistance(note);
  const params = [];
  // pitch: whole semitones go on the note, the rest on fine tune (127 steps span a semitone)
  const st = pitchOffset(note, seed, amount.pitch);
  const whole = Math.round(st), frac = st - whole;
  const { fine } = pitchPars(voice);
  if (fine !== undefined) params.push([fine, clamp(Math.round(base[fine] + frac * 127), 0, 127)]);
  // timbre: each morphable parameter moves around its base, at most weight x its range at full depth on the far keys
  const t = amount.timbre * dist;
  for (const e of schema) {
    if (e.morph !== 'timbre') continue;
    const b = base[e.par];
    if (!t) { params.push([e.par, b]); continue; }
    const [lo0, hi0] = Array.isArray(e.rand) ? e.rand : [e.min, e.max];
    const lo = Math.min(lo0, b), hi = Math.max(hi0, b); // the base stays reachable, even outside the range
    const v = b + unit(seed, note, e.par) * t * e.weight * (hi - lo);
    params.push([e.par, clamp(Math.round(v), lo, hi)]);
  }
  return { note: BASE_NOTE + whole, params, semitones: st };
}

// the combined depth of a sound: global depth x sound depth, times the pitch or timbre sliders (all 0..1)
export function combinedAmount(global, sound) {
  const d = global.depth * sound.depth;
  return { pitch: d * global.pitch * sound.pitch, timbre: d * global.timbre * sound.timbre };
}

// a new seed (the only place the morph uses chance; the seed itself is what's kept)
export const newSeed = () => (Math.random() * 0x100000000) >>> 0;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
