// node tools/levels.mjs: how loud every sound of the sound bucket is (as each engine's own kind: the drums' sounds on
// the drum engines, and so on) (sound/level.js), engine by engine, and the
// median of each engine: AUTO LEVEL's targets (LEVEL_TARGET_DB in sound/level.js are these, rounded to half a dB).
import { SOUNDS, INIT_VALUES, PAR } from '../sound/schema.js';
import { BUCKET } from '../sound/bucket-sounds.js';
import { toVoice } from '../sound/bucket.js';
import { measure, trimFor, LEVEL_TARGET_DB } from '../sound/level.js';
import { trimDb } from '../sound/schema.js';

const q = (a, f) => a[Math.min(a.length - 1, Math.floor(f * a.length))];
const t0 = Date.now(); let n = 0;
SOUNDS.forEach((def, sound) => {
  const v = def.engineVoice, seen = new Set(), dbs = [], peaks = [], after = [];
  for (const snd of BUCKET) {
    if (!def.sources.includes(snd.voice)) continue;
    const vals = toVoice(snd, v).filter(([p]) => p !== PAR.VOL1 + v);
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
