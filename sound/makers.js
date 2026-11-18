// More ways to make a new sound (NEW SOUNDS FROM in the RANDOM menu), beside KIT (a kit sound as it is) and BREED
// (sound/breed.js). Each takes the engine voice's schema and the kit sounds the engine can draw from (main.js pool():
// [{ label, vals: [[parameter, value], ...] }]) and returns a new { label, vals }. Pure: no DOM, no audio, no
// Math.random (the chance comes in as rnd). The page plays each result offline and skips duds (breed.js isDud).
//
//   MORPH      two kit sounds blended at a random point between them (25..75%): every knob in between, every
//              switch from the nearer one
//   KIT-STYLE  one kit sound's switches and routing, every knob a value some other kit sound has for that knob:
//              new sounds that stay in the ranges the kits use
//   FREE       one kit sound's switches and routing, every knob anywhere in its drum-safe range
//   RECIPE     a named sound (kick, tom, mid perc, snare, clap, rim, closed hat, open hat, cymbal, cowbell, zap): a kit sound
//              of the right type, with the knobs that make that sound set inside the recipe's ranges

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const pick = (a, rnd) => a[Math.floor(rnd() * a.length)];
// a knob that moves smoothly (a number, a plus-minus or a morphable switch), not a menu, a modulation target or a
// sound's kind
const isKnob = (e) => e.display.type === 'num' || e.display.type === 'pm' || e.display.type === 'detent';
// the knobs a maker may set: not hidden, not the mix (LEVEL, sends), the pan (its own rule), the sequencer or trim
const makes = (e) => isKnob(e) && !e.hidden && !e.seq && !e.strict && e.rand !== 'mix' && e.ukey !== 'pan';
// a value of a parameter in a sound, or the fallback (the engine's base) if the sound hasn't got it
const valOf = (m, par, base) => (m.has(par) ? m.get(par) : base ? base[par] : undefined);

// ---- MORPH ----
export function morph({ schema, pool, rnd, base }) {
  const a = pick(pool, rnd); let b; do b = pick(pool, rnd); while (pool.length > 1 && b === a);
  const t = 0.25 + rnd() * 0.5, A = new Map(a.vals), B = new Map(b.vals), out = new Map();
  for (const p of new Set([...A.keys(), ...B.keys()])) out.set(p, (t < 0.5 ? valOf(A, p) ?? B.get(p) : valOf(B, p) ?? A.get(p)));
  for (const e of schema) {
    if (!makes(e)) continue;
    const x = valOf(A, e.par, base), y = valOf(B, e.par, base);
    if (x === undefined || y === undefined) continue;
    out.set(e.par, clamp(Math.round(x + t * (y - x)), 0, e.max));
  }
  return { label: `${a.label} ~ ${b.label} ${Math.round(t * 100)}%`, vals: [...out] };
}

// ---- KIT-STYLE ----
export function kitStyle({ schema, pool, rnd, base }) {
  const a = pick(pool, rnd), out = new Map(a.vals);
  for (const e of schema) {
    if (!makes(e)) continue;
    const m = new Map(pick(pool, rnd).vals), x = valOf(m, e.par, base);
    if (x !== undefined) out.set(e.par, x);
  }
  return { label: `kit-style (${a.label})`, vals: [...out] };
}

// ---- FREE ----
// each knob anywhere in its drum-safe range (rand [lo, hi]); coarse anywhere the kits put it; a knob with no drum
// range (the LFO, the morphable switches) keeps the kit sound's
export function free({ schema, pool, rnd }) {
  const a = pick(pool, rnd), out = new Map(a.vals);
  for (const e of schema) {
    if (!makes(e)) continue;
    let r = e.rand;
    if (r === 'pitch') r = [20, 110];
    if (!Array.isArray(r)) continue;
    out.set(e.par, clamp(r[0] + Math.floor(rnd() * (r[1] - r[0] + 1)), 0, e.max));
  }
  return { label: `free (${a.label})`, vals: [...out] };
}

// ---- RECIPES ----
// from: which kit voices it starts from (by the end of the pool's label); set: merged control (ukey) -> [lo, hi]
// (a single number for an exact value). Waves: 0 sine, 25 tri, 50 saw, 75 rec, 100 pwm, 125 noise. Filter types:
// 0 lp, 18 bp, 36 unity bp, 54 hp, 72 notch, 90 peak, 108 lp2, 126 off. Ranges from the kits' own sounds of that kind
export const RECIPES = {
  kick: { from: /drum \d$/, set: { coarse: [22, 32], wave: 0, pamt: [55, 115], pdecay: [30, 75], pslope: [2, 20], decay: [15, 45], attack: 0,
    cutoff: [55, 127], reso: [0, 30], again: [0, 20], clickvol: [20, 110] } },
  tom: { from: /drum \d$/, set: { coarse: [33, 46], wave: [0, 25], pamt: [20, 55], pdecay: [30, 65], decay: [12, 35], attack: 0, again: [0, 15],
    clickvol: [0, 60], cutoff: [70, 127], reso: [0, 40] } },
  snare: { from: /snare$/, set: { coarse: [38, 54], nmix: [60, 115], ncolour: [80, 127], decay: [8, 30], pamt: [20, 50], pdecay: [40, 75], attack: 0,
    cutoff: [80, 127], reso: [0, 50] } },
  clap: { from: /snare$/, set: { repeat: [2, 4], nmix: [110, 127], ncolour: [100, 127], decay: [6, 18], attack: 0, ftype: 18, cutoff: [80, 110],
    reso: [20, 60], pamt: [0, 10], clickvol: [0, 30] } },
  rim: { from: /drum \d$|snare$/, set: { coarse: [55, 75], decay: [3, 9], pamt: [10, 40], pdecay: [10, 40], click: 6, clickvol: [80, 127],
    attack: 0, cutoff: [90, 127] } },
  'closed hat': { from: /hihat$|cymbal$/, set: { coarse: [70, 127], decay: [2, 10], attack: 0, ftype: 54, cutoff: [95, 125], reso: [0, 50],
    again: [80, 127], bgain: [80, 127] } },
  'open hat': { from: /hihat$|cymbal$/, set: { coarse: [70, 127], decay: [30, 70], attack: 0, ftype: 54, cutoff: [90, 120], reso: [0, 40],
    again: [80, 127], bgain: [80, 127] } },
  cymbal: { from: /cymbal$/, set: { decay: [60, 110], attack: 0, ftype: [18, 54], cutoff: [80, 120], again: [60, 127], bgain: [60, 127] } },
  cowbell: { from: /cymbal$|hihat$/, set: { wave: 75, coarse: [60, 80], afreq: [55, 75], again: [0, 30], bgain: [0, 20], decay: [10, 30],
    attack: 0, ftype: 18, cutoff: [80, 105], reso: [20, 60] } },
  'mid perc': { from: /drum \d$/, set: { coarse: [44, 62], wave: [0, 75], pamt: [5, 35], pdecay: [20, 50], decay: [6, 22], attack: 0, again: [0, 40],
    clickvol: [20, 90], cutoff: [70, 127], reso: [0, 50] } },
  zap: { from: /drum \d$/, set: { coarse: [40, 75], wave: [0, 50], pamt: [100, 127], pdecay: [5, 25], decay: [5, 20], attack: 0, again: [0, 30],
    clickvol: [0, 40] } },
};
// the recipes this pool can make (each needs a kit sound of its type)
export const recipesFor = (pool) => Object.keys(RECIPES).filter((k) => pool.some((s) => RECIPES[k].from.test(s.label)));
export function recipe({ schema, pool, rnd, name }) {
  const names = recipesFor(pool);
  if (!names.length) return free({ schema, pool, rnd });
  name = name && names.includes(name) ? name : pick(names, rnd);
  const r = RECIPES[name], a = pick(pool.filter((s) => r.from.test(s.label)), rnd), out = new Map(a.vals);
  for (const e of schema) {
    const want = r.set[e.ukey];
    if (want === undefined || e.hidden) continue;
    const [lo, hi] = Array.isArray(want) ? want : [want, want];
    out.set(e.par, clamp(lo + Math.floor(rnd() * (hi - lo + 1)), 0, e.max));
  }
  return { label: `${name} (${a.label})`, vals: [...out], recipe: name };
}

// ---- MORPH KEYS (the RANDOM menu): one sound on the lowest key, another on the highest, every key between a step
// of the way from one to the other. blend() is one of those steps, t of the way from a (0) to b (1), both already
// in this voice's parameters. Knobs (numbers, plus-minus, the morphable switches) slide; a menu or a modulation
// target can't blend, so it flips at the halfway point. A part that's off on one side (its gain at 0) keeps the
// settings of the side where it's on, so its gain fades it in or out without it passing through settings neither
// sound has ----
export const GATES = {
  again: ['afreq', 'awave', 'amode', 'fmenv'], bgain: ['bfreq', 'bwave'], nmix: ['ncolour', 'rnoise'],
  clickvol: ['click', 'clickfreq', 'rclick'], pamt: ['pdecay', 'pslope'],
};
export function blend({ schema, a, b, t, base }) {
  const byPar = new Map(schema.map((e) => [e.par, e])), byU = new Map(schema.map((e) => [e.ukey, e]));
  const get = (m, p) => valOf(m, p, base), side = new Map();
  for (const [g, parts] of Object.entries(GATES)) {
    const e = byU.get(g); if (!e) continue;
    const x = get(a, e.par) > 0, y = get(b, e.par) > 0;
    if (x === y) continue;
    for (const u of parts) { const q = byU.get(u); if (q) side.set(q.par, x ? a : b); }
  }
  const flip = t < 0.5 ? a : b, out = new Map();
  for (const p of new Set([...a.keys(), ...b.keys()])) {
    const e = byPar.get(p), x = get(a, p), y = get(b, p);
    if (x === undefined || y === undefined) { out.set(p, x ?? y); continue; }
    const from = side.get(p);
    if (from) out.set(p, get(from, p));
    else if (e && isKnob(e)) out.set(p, clamp(Math.round(x + t * (y - x)), 0, e.max));
    else out.set(p, get(flip, p));
  }
  return out;
}

// every method but KIT and BREED (which the page makes itself), by its NEW SOUNDS FROM name
export const MAKERS = { morph, kitstyle: kitStyle, free, recipe };
