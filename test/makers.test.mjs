// node test/makers.test.mjs: the NEW SOUNDS FROM methods in sound/makers.js (MORPH, KIT-STYLE, FREE, RECIPE). Every
// result stays inside each control's range, a recipe sets its knobs inside its ranges, MORPH lands between its
// parents, and few results are duds (nearly silent, or ringing on) for the page's dud filter to skip.
import { SOUNDS, INIT_VALUES, PAR, mapVoice, VOICE_SCHEMAS } from '../sound/schema.js';
import { KITS } from './bucket-kits.mjs';
import { measure, LEVEL_TARGET_DB } from '../sound/level.js';
import { isDud } from '../sound/breed.js';
import { MAKERS, RECIPES, recipe, morph } from '../sound/makers.js';
let fails = 0, checks = 0;
const ok = (c, m) => { checks++; if (!c) { fails++; if (fails < 30) console.log('FAIL', m); } };
const kits = KITS;
let seed = 987; const rnd = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };
const VN = ['drum 1', 'drum 2', 'drum 3', 'snare', 'cymbal', 'hihat'];
[0, 1, 2].forEach((sound) => {
  const def = SOUNDS[sound], v = def.engineVoice, sc = VOICE_SCHEMAS[v], byPar = new Map(sc.map((e) => [e.par, e])), pool = [];
  const srcs = def.sources || [{ 0: [0, 1, 2], 1: [3], 2: [4, 5] }[sound]].flat();
  for (const { name, kit, drums } of kits) for (const src of srcs) pool.push({ label: `${drums[src] || name} ${VN[src]}`, vals: mapVoice(kit, src, v).filter(([p]) => p !== PAR.VOL1 + v) });
  const line = [];
  for (const [m, make] of Object.entries(MAKERS)) {
    let duds = 0; const N = 60;
    for (let i = 0; i < N; i++) {
      const s = make({ schema: sc, pool, rnd, base: INIT_VALUES });
      ok(s.label && s.label.length <= 48, `${m}: label ${s.label}`);
      for (const [p, x] of s.vals) { const e = byPar.get(p); if (e && e.display.type !== 'menu' && e.display.type !== 'target') ok(Number.isInteger(x) && x >= 0 && x <= 255, `${m} ${e.ukey} = ${x}`); }
      if (isDud(measure(sound, INIT_VALUES, s.vals), LEVEL_TARGET_DB[sound])) duds++;
    }
    line.push(`${m} ${duds}/${N}`);
    ok(duds / N < 0.3, `${def.name} ${m}: ${duds} of ${N} duds`);
  }
  // a recipe's knobs land inside its ranges
  for (const name of Object.keys(RECIPES)) {
    if (!pool.some((s) => RECIPES[name].from.test(s.label))) continue;
    const s = recipe({ schema: sc, pool, rnd, name }), m = new Map(s.vals);
    ok(s.recipe === name, `recipe ${name}`);
    for (const e of sc) { const w = RECIPES[name].set[e.ukey]; if (w === undefined || e.hidden) continue;
      const [lo, hi] = Array.isArray(w) ? w : [w, w]; ok(m.get(e.par) >= Math.min(lo, e.max) && m.get(e.par) <= Math.min(hi, e.max), `${name} ${e.ukey} ${m.get(e.par)}`); }
  }
  console.log(`${def.name}: duds ${line.join(', ')}`);
});
console.log(fails ? `${fails} of ${checks} checks failed` : `all ${checks} checks pass`);
process.exit(fails ? 1 : 0);
