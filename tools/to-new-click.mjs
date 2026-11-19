// Moves every bucket sound (bucket/*.json) from the firmware's sampled click onto the new click (engine/click.js), the
// nearest one to the sample it played (sound/schema.js oldClick). Then rebuild: node tools/build-bucket.mjs
//   node tools/to-new-click.mjs
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { soundClicks } from '../sound/schema.js';

const dir = new URL('../bucket/', import.meta.url);
let moved = 0, kept = 0;
for (const f of readdirSync(dir).filter((x) => /\.json$/i.test(x))) {
  const s = JSON.parse(readFileSync(new URL(f, dir), 'utf8')), t = soundClicks(s);
  if (t === s) { kept++; continue; }
  writeFileSync(new URL(f, dir), JSON.stringify(t, null, 1) + '\n'); moved++;
}
console.log(`bucket: ${moved} sounds moved onto the new click, ${kept} on it already`);
