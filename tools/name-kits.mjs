// node tools/name-kits.mjs: names the kits and their drums with the preset namer (app/names.js), then rebuilds
// sound/kits.js. A kit with no name here yet gets one: its file is renamed (the number in front, if any, is kept:
// "00-LAMBO.SND" -> "00-QUANDALF.SND"), and the 8-letter name inside the file is set to it. Each of its six drums
// (drum 1, drum 2, drum 3, snare, cymbal, hihat) gets a name too, kept in kits/names.json by file. Every name is new
// and none is used twice. Kits already in kits/names.json are left as they are, so the names never change once given.
import { readFileSync, writeFileSync, readdirSync, renameSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { jumble } from '../app/names.js';

const dir = new URL('../kits/', import.meta.url), list = new URL('names.json', dir);
const names = existsSync(list) ? JSON.parse(readFileSync(list, 'utf8')) : {};
const taken = new Set(Object.values(names).flatMap((n) => [n.kit, ...n.drums]));
// a seeded generator (the names come out the same for the same kits), as in test/names.test.mjs
let seed = 20261118; const rng = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };
// 5 to 8 letters: the name in the file has room for 8, and a drum's name sits in labels such as "A ~ B 50%"
const fresh = () => { for (;;) { const w = jumble(rng, 5, 8).toUpperCase(); if (!taken.has(w)) { taken.add(w); return w; } } };

const files = readdirSync(dir, { recursive: true }).filter((f) => /\.snd$/i.test(f)).sort();
let n = 0;
for (const f of files) {
  if (names[f]) continue;
  const kit = fresh(), drums = Array.from({ length: 6 }, fresh);
  const m = f.match(/^(.*\/)?((?:PROJ\d+-\d+|E?\d+)-)?[^/]*\.snd$/i), to = `${m[1] || ''}${m[2] || ''}${kit}.SND`;
  if (to !== f && existsSync(new URL(to, dir))) throw new Error(`${to} is there already`);
  const bytes = readFileSync(new URL(f, dir));
  bytes.fill(0x20, 0, 8); bytes.write(kit, 0, 'latin1'); // (the name in the file: 8 characters, padded with spaces)
  writeFileSync(new URL(f, dir), bytes);
  if (to !== f) renameSync(new URL(f, dir), new URL(to, dir));
  names[to] = { kit, drums, was: f }; n++;
}
const sorted = Object.fromEntries(Object.keys(names).sort().map((k) => [k, names[k]]));
writeFileSync(list, JSON.stringify(sorted, null, 1) + '\n');
console.log(`named ${n} kits (${Object.keys(names).length} in kits/names.json)`);
execFileSync(process.execPath, [new URL('build-kits.mjs', import.meta.url).pathname], { stdio: 'inherit' });
