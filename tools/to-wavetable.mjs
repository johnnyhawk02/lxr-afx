// Moves every bucket sound (bucket/*.json) from the CLASSIC waves onto the BASIC wavetable, at the place that plays its
// wave (sound/tables.js soundToBasic); noise waves stay on CLASSIC. Then rebuild: node tools/build-bucket.mjs
//   node tools/to-wavetable.mjs
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { soundToBasic } from '../sound/tables.js';

const dir = new URL('../bucket/', import.meta.url);
let moved = 0, kept = 0;
for (const f of readdirSync(dir).filter((x) => /\.json$/i.test(x))) {
  const s = JSON.parse(readFileSync(new URL(f, dir), 'utf8')), t = soundToBasic(s);
  if (t === s) { kept++; continue; }
  writeFileSync(new URL(f, dir), JSON.stringify(t, null, 1) + '\n'); moved++;
}
console.log(`bucket: ${moved} sounds moved onto BASIC, ${kept} left as they were (noise, or on a table already)`);
