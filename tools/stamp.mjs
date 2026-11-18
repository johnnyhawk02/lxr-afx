// node tools/stamp.mjs: a new version stamp (?v=...) on every app module and stylesheet URL, so a browser holding older
// files in its cache (GitHub Pages caches for 10 minutes) loads the whole new set together, never a mix of old and new.
// Run it before each commit that changes the page. (engine/lxr.js is stamped where sound/ imports it: it isn't the firmware
// port as it was any more, it changes with the page)
import { readFileSync, writeFileSync } from 'node:fs';
const v = Date.now().toString(36);
for (const f of ['index.html', 'app/main.js', 'sound/morph.js', 'sound/instrument.js', 'sound/worklet.js', 'sound/dirt.js', 'sound/level.js', 'sound/breed.js', 'sound/schema.js', 'sound/makers.js', 'sound/bucket.js']) {
  const s = readFileSync(f, 'utf8'), t = s.replace(/\?v=[0-9a-z]+/g, '?v=' + v);
  if (t !== s) writeFileSync(f, t);
}
console.log('stamped', v);
