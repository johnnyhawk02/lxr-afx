// Takes every sound out of every kit (kits/**/*.SND: six voices each) into the sound bucket, one file per sound in
// bucket/, named after the kit drum (kits/names.json). A sound already in the bucket (the same voice and values) isn't
// added twice, and a kit voice taken out before is skipped, so it can be run again after adding kits. Then it
// rebuilds sound/bucket-sounds.js.
//   node tools/extract-bucket.mjs
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { parseSnd } from '../sound/schema.js';
import { fromKit, fileOf, TYPES } from '../sound/bucket.js';

const kitDir = new URL('../kits/', import.meta.url), dir = new URL('../bucket/', import.meta.url);
const names = JSON.parse(readFileSync(new URL('names.json', kitDir), 'utf8'));
const files = readdirSync(kitDir, { recursive: true }).filter((f) => /\.snd$/i.test(f)).sort();
const have = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(new URL(f, dir), 'utf8')));
const sig = (s) => `${s.voice}|${JSON.stringify(s.params)}`;
const sigs = new Set(have.map(sig)), froms = new Set(have.map((s) => s.from)), taken = new Set(have.map((s) => fileOf(s)));
let n = have.filter((s) => s.from?.startsWith('kits/')).length, added = 0, same = 0;
files.forEach((f, ki) => {
  const { name, kit } = parseSnd(readFileSync(new URL(f, kitDir)));
  const drums = names[f]?.drums || [];
  TYPES.forEach((type, src) => {
    const from = `kits/${f} ${type}`;
    if (froms.has(from)) return;
    let s = fromKit(kit, src, { name: drums[src] || `${name}-${src + 1}`, from, n: ki * 6 + src });
    if (sigs.has(sig(s))) { same++; return; }
    let file = fileOf(s), k = 2;
    while (taken.has(file)) { s = { ...s, name: `${drums[src] || name}-${k++}` }; file = fileOf(s); }
    taken.add(file); sigs.add(sig(s)); froms.add(from);
    writeFileSync(new URL(file, dir), JSON.stringify(s, null, 1) + '\n'); added++; n++;
  });
});
console.log(`bucket/: ${added} kit sounds added (${same} skipped: the same as one already in the bucket), ${n} from kits in all`);
execFileSync(process.execPath, [new URL('build-bucket.mjs', import.meta.url).pathname], { stdio: 'inherit' });
