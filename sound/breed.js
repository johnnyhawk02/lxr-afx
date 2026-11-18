// BREED: a new sound made from two kit sounds of the same engine, the way a breeding synth crosses two parents.
// The child takes each section whole from one parent or the other (oscillator with its pitch envelope and noise,
// FM, amp envelope, click, filter, LFO with velocity, and the mix settings), so what makes each part work stays together,
// and it always takes at least one section from each parent. Then every continuous control is nudged a little
// inside its drum-safe range. Pure: no DOM, no audio, no Math.random (the chance comes in as rnd).
//
//   breed({ schema, a, b, rnd, nudge }) -> { vals, from }
//     schema  the engine voice's parameter schema (schema.js VOICE_SCHEMAS[v])
//     a, b    the parents' values, [[parameter, value], ...] (as scatter's pool holds them)
//     rnd     () -> 0..1
//     nudge   how far a continuous control may move, as a fraction of its drum-safe range (0.06 as it comes)
//   returns the child's values, [[parameter, value], ...], and from: each section's parent ('a' or 'b')

// the sections a child takes whole, by the schema's section names. A parameter the schema doesn't list (the LFO's
// voice) goes with the LFO
// (the merged voice's sections: mod A and mod B are one gene, the FM; the noise goes with the tone; the filter with
// what goes into it; the kind with the amp, whose last steps it sets)
export const GENES = [['osc', 'pitch', 'noise'], ['mod a', 'mod b'], ['amp', 'kind'], ['click'], ['filter', 'filter in'], ['lfo', 'velocity', 'mod'], ['mix']];
export const BREED_NUDGE = 0.06;

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export function breed({ schema, a, b, rnd, nudge = BREED_NUDGE }) {
  const sectionOf = new Map(schema.map((e) => [e.par, e.section]));
  const geneOf = (par) => { const s = sectionOf.get(par) || 'lfo'; const i = GENES.findIndex((g) => g.includes(s)); return i < 0 ? GENES.length - 1 : i; };
  // the genes the parents have
  const have = [...new Set([...a, ...b].map(([p]) => geneOf(p)))].sort((x, y) => x - y);
  // each gene from a or b at even odds, but never all from one parent
  let pick;
  do pick = new Map(have.map((g) => [g, rnd() < 0.5 ? 'a' : 'b']));
  while (have.length > 1 && new Set(pick.values()).size < 2);
  const A = new Map(a), B = new Map(b), out = new Map();
  for (const p of new Set([...A.keys(), ...B.keys()])) {
    const from = pick.get(geneOf(p)) === 'a' ? A : B, other = from === A ? B : A;
    out.set(p, from.has(p) ? from.get(p) : other.get(p));
  }
  // the nudge: continuous controls only (not a menu, switch, target, pan or mix level), inside the drum-safe range
  // (or as far as the parent's own value, if that lies outside it)
  if (nudge > 0) for (const e of schema) {
    if (!out.has(e.par) || e.strict || e.max < 20 || !Array.isArray(e.rand) || (e.display.type !== 'num' && e.display.type !== 'pm')) continue;
    const h = out.get(e.par), [r0, r1] = e.rand, lo = Math.min(r0, h), hi = Math.max(r1, h);
    out.set(e.par, clamp(Math.round(h + (rnd() * 2 - 1) * nudge * (r1 - r0)), lo, hi));
  }
  return { vals: [...out], from: Object.fromEntries([...pick].map(([g, w]) => [GENES[g].join('+'), w])) };
}

// the dud filter: a child that is nearly silent next to its engine's level, or still as loud as it got after 1.5 s
// (it swells or rings on), is not used. m: level.js measure() of the child; target: its engine's LEVEL_TARGET_DB
export const DUD_QUIET_DB = 24;
export const isDud = (m, target) => !(m.db > target - DUD_QUIET_DB) || m.held;
