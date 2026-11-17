// node tools/levels.mjs: how loud every sound of the built-in kits is (sound/level.js), engine by engine, and the
// median of each engine: AUTO LEVEL's targets (LEVEL_TARGET_DB in sound/level.js are these, rounded to half a dB).
import { SOUNDS, INIT_VALUES, PAR, parseSnd, mapVoice } from '../sound/schema.js';
import { KIT_FILES } from '../sound/kits.js';
import { measure, trimFor, LEVEL_TARGET_DB } from '../sound/level.js';
import { trimDb } from '../sound/schema.js';

const kits = KIT_FILES.map((k) => parseSnd(Uint8Array.from(Buffer.from(k.data, 'base64'))));
const q = (a, f) => a[Math.min(a.length - 1, Math.floor(f * a.length))];
const t0 = Date.now(); let n = 0;
SOUNDS.forEach((def, sound) => {
  const v = def.engineVoice, seen = new Set(), dbs = [], peaks = [], after = [];
  for (const { kit } of kits) for (const src of def.sources) {
    const vals = mapVoice(kit, src, v).filter(([p]) => p !== PAR.VOL1 + v);
    const sig = vals.map(([, x]) => x).join(',');
    if (seen.has(sig)) continue;
    seen.add(sig);
    const m = measure(sound, INIT_VALUES, vals); n++;
    if (!(m.db > -90)) continue;
    dbs.push(m.db); peaks.push(m.peak);
    after.push(m.db + trimDb(trimFor(sound, m)));
  }
  dbs.sort((a, b) => a - b); after.sort((a, b) => a - b);
  const f = (x) => x.toFixed(1).padStart(6);
  console.log(`${def.name.padEnd(6)} ${String(dbs.length).padStart(4)} sounds  min ${f(dbs[0])}  10% ${f(q(dbs, 0.1))}  median ${f(q(dbs, 0.5))}  90% ${f(q(dbs, 0.9))}  max ${f(dbs[dbs.length - 1])} dB`
    + `   target ${LEVEL_TARGET_DB[sound]}   levelled: 10% ${f(q(after, 0.1))}  90% ${f(q(after, 0.9))}  (within 1 dB of target: ${Math.round(100 * after.filter((x) => Math.abs(x - LEVEL_TARGET_DB[sound]) <= 1).length / after.length)}%)`);
});
console.log(`${n} sounds measured in ${Date.now() - t0} ms (${((Date.now() - t0) / n).toFixed(1)} ms each)`);
