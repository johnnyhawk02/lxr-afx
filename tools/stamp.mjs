// node tools/stamp.mjs: a new version stamp (?v=...) on every app module and stylesheet URL, so a browser holding older
// files in its cache (GitHub Pages caches for 10 minutes) loads the whole new set together, never a mix of old and new.
// Run it before each commit that changes the page. (engine/ is the firmware port and vendor/ is three.js,
// both copied as they are: never stamped)
import { readFileSync, writeFileSync } from 'node:fs';
const v = Date.now().toString(36);
for (const f of ['index.html', 'app/main.js', 'sound/morph.js', 'sound/instrument.js', 'sound/worklet.js']) {
  const s = readFileSync(f, 'utf8'), t = s.replace(/\?v=[0-9a-z]+/g, '?v=' + v);
  if (t !== s) writeFileSync(f, t);
}
console.log('stamped', v);
