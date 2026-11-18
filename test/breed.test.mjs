// node test/breed.test.mjs: BREED (sound/breed.js). A child takes each section whole from one parent, never all from
// one, stays inside each control's range, and the dud filter lets few of the children through as duds.
import { SOUNDS, INIT_VALUES, PAR, mapVoice, VOICE_SCHEMAS } from '../sound/schema.js';
import { KITS } from './bucket-kits.mjs';
import { measure, LEVEL_TARGET_DB } from '../sound/level.js';
import { breed, isDud, GENES } from '../sound/breed.js';
let fails = 0, checks = 0;
const ok = (c, m) => { checks++; if (!c) { fails++; console.log('FAIL', m); } };
const kits = KITS;
let seed = 12345; const rnd = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };
SOUNDS.forEach((def, sound) => {
  const v = def.engineVoice, sc = VOICE_SCHEMAS[v], pool = [];
  for (const { kit } of kits) for (const src of def.sources) pool.push(mapVoice(kit, src, v).filter(([p]) => p !== PAR.VOL1 + v));
  const sec = new Map(sc.map((e) => [e.par, e.section])), byPar = new Map(sc.map((e) => [e.par, e]));
  let duds = 0; const N = 120;
  for (let i = 0; i < N; i++) {
    const a = pool[Math.floor(rnd() * pool.length)], b = pool[(Math.floor(rnd() * (pool.length - 1)) + 1 + pool.indexOf(a)) % pool.length];
    const A = new Map(a), B = new Map(b), { vals, from } = breed({ schema: sc, a, b, rnd, nudge: 0 });
    ok(new Set(Object.values(from)).size === 2 || Object.keys(from).length < 2, `${def.name}: both parents give a section`);
    for (const [p, x] of vals) { // without the nudge, every value is its section's parent's
      const g = GENES.findIndex((gs) => gs.includes(sec.get(p) || 'lfo')), w = from[GENES[g].join('+')];
      const P = w === 'a' ? A : B, Q = P === A ? B : A; // (a control one parent lacks comes from the other)
      ok(x === (P.has(p) ? P.get(p) : Q.get(p)), `${def.name}: par ${p} from parent ${w}`);
    }
    const n = breed({ schema: sc, a, b, rnd }), nf = n.from;
    for (const [p, x] of n.vals) { // a nudged control stays inside its range (or the parent's value, if outside it)
      const e = byPar.get(p); if (!e || !Array.isArray(e.rand) || e.strict) continue;
      const h = (nf[GENES.find((gs) => gs.includes(e.section)).join('+')] === 'a' ? A : B).get(p) ?? A.get(p) ?? B.get(p);
      ok(x >= Math.min(e.rand[0], h) && x <= Math.max(e.rand[1], h), `${def.name} ${e.key} in range: ${x}`); }
    if (isDud(measure(sound, INIT_VALUES, n.vals), LEVEL_TARGET_DB[sound])) duds++;
  }
  ok(duds / N < 0.15, `${def.name}: ${duds} of ${N} children are duds`);
  console.log(`${def.name}: ${duds} of ${N} bred children would be skipped as duds`);
});
console.log(fails ? `${fails} of ${checks} checks failed` : `all ${checks} checks pass`);
process.exit(fails ? 1 : 0);
