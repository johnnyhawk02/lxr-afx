// node test/keymorph.test.mjs: MORPH KEYS' blend (sound/makers.js). Between two kit sounds every knob moves steadily
// from one end to the other, menus and targets flip at the halfway point, a part whose gain is 0 at one end keeps the
// other end's settings all the way, and the in-between keys are seldom duds.
import { SOUNDS, INIT_VALUES, PAR, parseSnd, mapVoice, VOICE_SCHEMAS } from '../sound/schema.js';
import { KIT_FILES } from '../sound/kits.js';
import { measure, LEVEL_TARGET_DB } from '../sound/level.js';
import { isDud } from '../sound/breed.js';
import { blend, GATES } from '../sound/makers.js';
let fails = 0, checks = 0;
const ok = (c, m) => { checks++; if (!c) { fails++; if (fails < 30) console.log('FAIL', m); } };
const kits = KIT_FILES.map((k) => parseSnd(Uint8Array.from(Buffer.from(k.data, 'base64'))));
let seed = 4242; const rnd = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };
const isKnob = (e) => ['num', 'pm', 'detent'].includes(e.display.type);
const GATED = Object.fromEntries(Object.entries(GATES).flatMap(([g, parts]) => parts.map((u) => [u, g])));
let duds = 0, tried = 0;
for (let n = 0; n < 40; n++) {
  const sound = Math.floor(rnd() * 3), v = SOUNDS[sound].engineVoice, sc = VOICE_SCHEMAS[v];
  const kitA = kits[Math.floor(rnd() * kits.length)].kit, kitB = kits[Math.floor(rnd() * kits.length)].kit;
  const a = new Map(mapVoice(kitA, Math.floor(rnd() * 6), v)), b = new Map(mapVoice(kitB, Math.floor(rnd() * 6), v));
  const steps = [0, 0.25, 0.49, 0.5, 0.75, 1].map((t) => blend({ schema: sc, a, b, t, base: INIT_VALUES }));
  const byU = new Map(sc.map((e) => [e.ukey, e]));
  for (const e of sc) {
    if (!a.has(e.par) || !b.has(e.par)) continue;
    const x = a.get(e.par), y = b.get(e.par), vs = steps.map((m) => m.get(e.par)), g = GATED[e.ukey] && byU.get(GATED[e.ukey]);
    const onA = g && a.get(g.par) > 0, onB = g && b.get(g.par) > 0;
    if (g && onA !== onB) { const want = onA ? x : y; ok(vs.every((q) => q === want), `${e.ukey}: gated part keeps the side where it's on (${vs})`); continue; }
    if (isKnob(e)) {
      ok(vs[0] === x && vs[5] === y, `${e.ukey}: ends ${vs[0]}/${x} ${vs[5]}/${y}`);
      for (let i = 1; i < vs.length; i++) ok((vs[i] - vs[i - 1]) * Math.sign(y - x) >= 0, `${e.ukey}: steady ${vs}`);
      ok(vs.every((q) => q >= 0 && q <= e.max), `${e.ukey}: in range ${vs}`);
    } else ok(vs[0] === x && vs[2] === x && vs[3] === y && vs[5] === y, `${e.ukey}: flips at half ${vs} (${x} -> ${y})`);
  }
  for (const m of steps.slice(1, 5)) { tried++; if (isDud(measure(sound, INIT_VALUES, [...m].filter(([p]) => p !== PAR.VOL1 + v)), LEVEL_TARGET_DB[sound])) duds++; }
}
ok(duds / tried < 0.3, `${duds} of ${tried} morphed keys are duds`);
console.log(`duds ${duds}/${tried}`);
console.log(fails ? `${fails} of ${checks} checks failed` : `all ${checks} checks pass`);
